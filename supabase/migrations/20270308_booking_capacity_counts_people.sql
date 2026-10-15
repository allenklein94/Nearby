-- Item 116 (owner, 2026-10-15): a business availability's capacity counts PEOPLE, everywhere.
-- Posting and matching already compared capacity with the request's party size (post_business_availability,
-- _match_request_to_availability_core, search_active_business_availability: remaining_capacity >= party_size), but both
-- accept paths took off 1 per booking and a cancellation gave back 1, so "N spots left" overstated what was left (20 spots,
-- a party of 6 books -> showed 19, really 14) and a party larger than what remained could still book (refused only at 0).
-- Now ONE pair of server helpers owns the arithmetic:
--   _take_availability_capacity(availability, party size)  -- one atomic conditional UPDATE: takes the whole party or refuses
--     ('This availability just filled up.', the existing message: no new string). Under concurrent accepts the second
--     writer waits for the first's row lock and re-checks remaining_capacity >= party, so capacity can never be overbooked.
--     Unknown party size holds 1 (at least one person; never a guess beyond that). No capacity limit = nothing held.
--   _release_availability_capacity(availability, held)     -- gives back exactly what the booking held, never above capacity.
-- business_request_offers.capacity_held records what each booking took, so a cancel returns exactly that; bookings made
-- before this migration have it null and give back 1, which is what they took. 'filled' is set only from 'active' (an
-- expired/cancelled availability is never relabelled filled).
-- accept_business_offer, _accept_business_offer_internal and _cancel_reservation_by_offer keep their signatures and
-- bodies except those lines (CREATE OR REPLACE keeps the existing grants; no second overload).

alter table public.business_request_offers
  add column if not exists capacity_held integer check (capacity_held is null or capacity_held > 0);
comment on column public.business_request_offers.capacity_held is
  'Item 116: people this accepted booking holds on its availability (released exactly on cancel). Null = no limited availability, or accepted before item 116 (held 1).';

create or replace function public._take_availability_capacity(availability_id_param uuid, party_size_param integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_seats integer := greatest(coalesce(party_size_param, 1), 1);
  v_left integer;
begin
  if availability_id_param is null then
    return null;
  end if;
  update business_availability
  set remaining_capacity = remaining_capacity - v_seats,
      status = case when remaining_capacity - v_seats = 0 and status = 'active' then 'filled' else status end
  where id = availability_id_param
    and remaining_capacity is not null
    and remaining_capacity >= v_seats;
  if found then
    return v_seats;
  end if;
  select remaining_capacity into v_left from business_availability where id = availability_id_param;
  if not found or v_left is null then
    return null; -- no such availability, or no capacity limit: nothing to hold
  end if;
  raise exception 'This availability just filled up.';
end;
$function$;

create or replace function public._release_availability_capacity(availability_id_param uuid, held_param integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if availability_id_param is null or coalesce(held_param, 0) <= 0 then
    return;
  end if;
  update business_availability
  set remaining_capacity = case when capacity is not null then least(capacity, remaining_capacity + held_param)
                                else remaining_capacity + held_param end,
      status = case when status = 'filled' then 'active' else status end
  where id = availability_id_param
    and remaining_capacity is not null;
end;
$function$;

revoke all on function public._take_availability_capacity(uuid, integer) from public, anon, authenticated;
revoke all on function public._release_availability_capacity(uuid, integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._accept_business_offer_internal(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  v_reservation_id uuid;
  v_held integer;
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
    -- Item 116: hold the whole party (the request's party size), refused when it does not fit.
    v_held := public._take_availability_capacity(v_offer.availability_id, v_request.party_size);
  end if;

  update business_request_offers set status = 'accepted', accepted_at = now(), capacity_held = v_held where id = offer_id_param;

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

CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_reservation_id uuid;
  v_managing_profiles uuid[];
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_consumer_title text;
  v_consumer_body text;
  v_held integer;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id <> auth.uid() then
    raise exception 'You do not own this request.';
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
    -- Item 116: hold the whole party (the request's party size), refused when it does not fit.
    v_held := public._take_availability_capacity(v_offer.availability_id, v_request.party_size);
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now(), capacity_held = v_held
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  returning id into v_reservation_id;

  -- Real, honest routing: a payable Stripe PaymentIntent can only follow
  -- when there's a real price AND the business has genuinely finished
  -- Connect onboarding (stripe_charges_enabled) -- otherwise this stays
  -- exactly the pre-Stripe 'not_required' state, never a fabricated
  -- pending charge nothing downstream can actually collect.
  select stripe_charges_enabled into v_stripe_ready
  from brand_partners where id = v_offer.partner_id;

  if v_offer.offer_price is not null and coalesce(v_stripe_ready, false) then
    v_payment_status := 'pending';
    v_payment_provider := 'stripe';
  else
    v_payment_status := 'not_required';
    v_payment_provider := null;
  end if;

  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider)
  values (v_reservation_id, v_payment_status, v_offer.offer_price, 'usd', auth.uid(), v_payment_provider);

  -- Item 125: the accept is an event; the notification layer tells the business, the customer and the rest of the plan.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'accept_business_offer',
    jsonb_build_object('request_id', v_request.id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public._cancel_reservation_by_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_reservation record;
  v_payment_id uuid;
  v_payment_blocked boolean;
  v_parent_request uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_offer.status <> 'accepted' then
    return jsonb_build_object('cancelled', false, 'reason', 'not_accepted');
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    return jsonb_build_object('cancelled', false, 'reason', 'not_confirmed');
  end if;

  select id into v_payment_id from business_payments where reservation_id = v_reservation.id for update;
  select exists(
    select 1 from business_payments where id = v_payment_id and status in ('captured', 'authorized')
  ) into v_payment_blocked;
  if v_payment_blocked then
    return jsonb_build_object('cancelled', false, 'reason', 'payment_captured');
  end if;

  update business_request_offers set status = 'cancelled', cancelled_at = now() where id = offer_id_param;
  update business_reservations set status = 'cancelled' where id = v_reservation.id;
  update business_payments set status = 'cancelled'
    where id = v_payment_id and status in ('not_required', 'pending');

  if v_offer.availability_id is not null then
    -- Item 116: give back exactly what this booking held (a booking made before item 116 held 1).
    perform public._release_availability_capacity(v_offer.availability_id, coalesce(v_offer.capacity_held, 1));
  end if;

  -- A cancelled reservation ends the booking: the request it fulfilled is now cancelled, and (for a primary request only --
  -- an add-on has no plan of its own) so is the Plan and any occasion group plan it fulfilled. Never touches a completed plan.
  select parent_request_id into v_parent_request from business_requests where id = v_offer.request_id;
  update business_requests set status = 'cancelled' where id = v_offer.request_id and status = 'fulfilled';
  if v_parent_request is null then
    update plans set status = 'cancelled'
    where resulting_business_request_id = v_offer.request_id and status in ('draft', 'confirmed');
    update occasion_group_plans set status = 'cancelled', cancelled_at = now()
    where status = 'fulfilled'
      and resulting_plan_id in (select id from plans where resulting_business_request_id = v_offer.request_id);
  end if;

  return jsonb_build_object('cancelled', true, 'offer_id', offer_id_param, 'request_id', v_offer.request_id, 'partner_id', v_offer.partner_id);
end;
$function$;
