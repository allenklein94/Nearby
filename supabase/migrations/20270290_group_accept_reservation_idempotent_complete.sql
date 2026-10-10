-- Group-plan bookings share the reservation lifecycle; completion is idempotent (owner item 12 follow-up, 2026-10-10).
--
-- What a reservation is: business_reservations has one row per accepted offer (UNIQUE offer_id) and NO person column:
-- it records that the offer is booked with the business, not who booked it. The person-specific record is the payment
-- row (business_payments.payer_id).
--
-- The gap: a direct accept (accept_business_offer) creates a confirmed 'nearby' reservation + a payment row in one
-- transaction. A group accept (confirm_group_plan_offer -> _accept_business_offer_internal, only once EVERY accepted
-- participant has confirmed) created no reservation, so complete_business_reservation, cancel_business_reservation (via
-- _cancel_reservation_by_offer) and mark_business_no_show all refused a group booking, and the business view showed
-- none.
--
-- Fix (owner-approved Option A):
--   1. _accept_business_offer_internal also creates the same confirmed 'nearby' reservation, in the same transaction as
--      the acceptance, and reuses one if it already exists. NO payment row: who pays for a group is undecided, and a
--      payer would invent a person. Its only caller is confirm_group_plan_offer, and only after the final confirmation,
--      so a partially confirmed group never gets one; any later failure rolls the whole thing back. Concurrency:
--      confirm_group_plan_offer locks the proposal and the offer FOR UPDATE, and this function re-locks the offer and
--      refuses anything but 'offered', so a second final confirmation waits, then is refused; UNIQUE(offer_id) plus
--      ON CONFLICT DO NOTHING makes a second row impossible either way.
--   2. complete_business_reservation is idempotent: repeating it on an offer that is already 'completed' returns success
--      and changes nothing. Authorization is checked FIRST (requester or that business only; another group participant
--      is refused), before any state answer.
-- Direct bookings: accept_business_offer is untouched. Nothing in production to backfill (0 group plans, 0 accepted
-- offers on 2026-10-10).

create or replace function public._accept_business_offer_internal(offer_id_param uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  v_reservation_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers set status = 'accepted', accepted_at = now() where id = offer_id_param;

  -- The group booking's reservation: the same confirmed 'nearby' row a direct accept creates, one per offer, reused if it
  -- exists. No payment row (no payer is invented for a group).
  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  on conflict (offer_id) do nothing
  returning id into v_reservation_id;
  if v_reservation_id is null then
    select id into v_reservation_id from business_reservations where offer_id = offer_id_param;
  end if;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id and id <> offer_id_param and status in ('pending', 'offered');

  update business_requests set status = 'fulfilled' where id = v_request.id;

  -- Item 125: the caller (confirm_group_plan_offer) emits BUSINESS_OFFER_ACCEPTED; the business push lives in its handler.
  return jsonb_build_object('success', true, 'reservationId', v_reservation_id);
end;
$function$;

revoke all on function public._accept_business_offer_internal(uuid) from public, anon, authenticated;
grant execute on function public._accept_business_offer_internal(uuid) to service_role;

create or replace function public.complete_business_reservation(offer_id_param uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_reservation record;
  v_partner_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  -- Who may complete it is decided before anything about its state: the requester or the business that made the offer.
  select * into v_request from business_requests where id = v_offer.request_id;
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if auth.uid() is null or (auth.uid() is distinct from v_request.requester_id and (v_partner_id is null or v_partner_id <> v_offer.partner_id)) then
    raise exception 'You are not part of this reservation.';
  end if;

  -- Idempotent: already completed = success, nothing changed (no second timestamp, plan update or event).
  if v_offer.status = 'completed' then
    return jsonb_build_object('success', true, 'alreadyCompleted', true);
  end if;

  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;
  if exists (select 1 from business_visit_no_shows where offer_id = offer_id_param) then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  update business_request_offers
  set status = 'completed', completed_at = now()
  where id = offer_id_param;

  -- Completing the primary booking completes the Plan (an add-on's reservation does not complete the whole plan).
  if not exists (select 1 from business_requests where id = v_offer.request_id and parent_request_id is not null) then
    update plans set status = 'completed'
    where resulting_business_request_id = v_offer.request_id and status = 'confirmed';
  end if;

  -- Item 125: recorded only (no redemption push, owner decision).
  perform public._emit_event('OFFER_REDEEMED', 'business_request_offer', offer_id_param, auth.uid(), 'complete_business_reservation',
    jsonb_build_object('request_id', v_offer.request_id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param,
                       'reservation_id', v_reservation.id),
    'OFFER_REDEEMED:' || offer_id_param);

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.complete_business_reservation(uuid) from public, anon;
grant execute on function public.complete_business_reservation(uuid) to authenticated;
