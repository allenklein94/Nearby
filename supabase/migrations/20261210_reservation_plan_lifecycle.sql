-- State-machine fixes, gaps 1-3 of PRODUCT_AUDIT/STATE_MACHINE_AUDIT_2026-09-19.md.
--
-- 1. A cancelled reservation now ends the booking everywhere: _cancel_reservation_by_offer (shared by the customer/business
--    cancel RPC, cancel_gathering and cancel_community) also sets the fulfilled request to cancelled and, for a primary
--    request, the Plan -> cancelled and any occasion group plan it fulfilled -> cancelled. Product call: the booking ENDS
--    (the request does not reopen to other businesses). An add-on's reservation only closes that add-on.
-- 2. Completing a primary reservation now sets the Plan to completed (plans.status='completed' was never written before).
--    The request->plan sync trigger no longer drags a completed plan back to confirmed.
-- 3. cancel_occasion_group_plan: the host can cancel in EVERY non-terminal state (voting, voting_business, decided,
--    fulfilled), not just voting. Cancelling cascades through the downstream request/offers/reservation/gathering/Plan, refuses
--    (rolling everything back) when a payment was already captured, and tells invited/joined participants
--    (occasion_group_plan_cancelled) -- the confirm dialog already promised "Everyone will be told".

create or replace function public.sync_plan_status_from_business_request()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.status = 'fulfilled' then
    update public.plans set status = 'confirmed' where resulting_business_request_id = new.id and status not in ('confirmed', 'completed');
  elsif new.status in ('cancelled', 'expired') then
    update public.plans set status = 'cancelled' where resulting_business_request_id = new.id and status not in ('cancelled', 'confirmed', 'completed');
  end if;
  return new;
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
    update business_availability
    set remaining_capacity = case when remaining_capacity is not null then remaining_capacity + 1 else remaining_capacity end,
        status = case when status = 'filled' and remaining_capacity is not null then 'active' else status end
    where id = v_offer.availability_id;
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

CREATE OR REPLACE FUNCTION public.complete_business_reservation(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id;
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();

  if auth.uid() <> v_request.requester_id and (v_partner_id is null or v_partner_id <> v_offer.partner_id) then
    raise exception 'You are not part of this reservation.';
  end if;

  update business_request_offers
  set status = 'completed', completed_at = now()
  where id = offer_id_param;

  -- Completing the primary booking completes the Plan (an add-on's reservation does not complete the whole plan).
  if not exists (select 1 from business_requests where id = v_offer.request_id and parent_request_id is not null) then
    update plans set status = 'completed'
    where resulting_business_request_id = v_offer.request_id and status = 'confirmed';
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.cancel_occasion_group_plan(plan_id_param uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_plan occasion_group_plans%rowtype;
  v_child plans%rowtype;
  v_offer record;
  v_res jsonb;
  v_participant record;
  v_wants boolean;
  service_key text;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if not found or v_plan.status not in ('voting', 'voting_business', 'decided', 'fulfilled') then
    raise exception 'This plan cannot be cancelled.';
  end if;

  -- Everything that was made from this plan (only exists once it is fulfilled).
  select * into v_child from plans where id = v_plan.resulting_plan_id;
  if v_child.id is not null and v_child.status <> 'completed' then
    if v_child.resulting_business_request_id is not null then
      for v_offer in
        select o.id from business_request_offers o
        where o.status = 'accepted'
          and o.request_id in (select id from business_requests
                               where id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id)
      loop
        v_res := _cancel_reservation_by_offer(v_offer.id);
        if v_res->>'reason' = 'payment_captured' then
          raise exception 'A payment has already been made for this plan. Contact the business directly to arrange a refund.';
        end if;
      end loop;
      update business_request_offers set status = 'cancelled'
      where status in ('pending', 'offered')
        and request_id in (select id from business_requests
                           where id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id);
      update business_requests set status = 'cancelled'
      where status = 'open' and (id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id);
    end if;
    if v_child.resulting_gathering_id is not null then
      -- Only the gathering's own host can cancel it (cancel_gathering checks); a gathering someone else hosts, or one that
      -- already happened, is left alone rather than blocking the cancellation.
      begin
        perform cancel_gathering(v_child.resulting_gathering_id);
      exception when others then
        null;
      end;
    end if;
    update plans set status = 'cancelled' where id = v_child.id and status <> 'completed';
  end if;

  update occasion_group_plans set status = 'cancelled', cancelled_at = now() where id = plan_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null then
    for v_participant in
      select user_id from occasion_group_plan_participants
      where group_plan_id = plan_id_param and status in ('invited', 'joined') and user_id is not null and user_id <> auth.uid()
    loop
      select coalesce(notify_planning, true) into v_wants from profiles where id = v_participant.user_id;
      if v_wants then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_participant.user_id,
            'title', '🚫 Plan cancelled',
            'body', v_plan.title || ' was cancelled by the host.',
            'data', jsonb_build_object('type', 'occasion_group_plan_cancelled', 'plan_id', plan_id_param)
          )
        );
      end if;
    end loop;
  end if;
end;
$function$;
