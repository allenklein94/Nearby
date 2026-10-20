-- Owner decision (2026-10-11, open question 1; built 2026-10-20): "Mark as Completed" is never allowed before the scheduled
-- visit DATE. On the visit day itself (any hour) and after, completion works as before.
--
-- The visit day uses the same precedence as _visit_starts_at and the business dashboard's visitDayKey: the accepted
-- alternative time (proposed_time), else the gathering's start, else the request's calendar date. "Day" is read in the
-- requester's profile timezone, the same zone _visit_starts_at uses; unknown/UTC falls back to Etc/GMT+12 (the latest day
-- boundary on earth), so the rule can never let a completion through before the visit date anywhere.
-- A reservation with no date on record has no visit day to wait for: completion stays allowed (unchanged).
-- Authorization stays first and the idempotent "already completed" answer stays before every state check.

create or replace function public._visit_local_day_reached(offer_id_param uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    coalesce((o.proposed_time at time zone z.tz)::date, (g.scheduled_at at time zone z.tz)::date, r.date)
      <= (now() at time zone z.tz)::date,
    true)
  from business_request_offers o
  join business_requests r on r.id = o.request_id
  left join gatherings g on g.id = r.gathering_id
  left join profiles p on p.id = r.requester_id
  cross join lateral (select coalesce(nullif(nullif(p.timezone, ''), 'UTC'), 'Etc/GMT+12') as tz) z
  where o.id = offer_id_param
$function$;

revoke all on function public._visit_local_day_reached(uuid) from public, anon, authenticated;

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

  -- Owner decision 2026-10-11 (1): never before the scheduled visit date.
  if not public._visit_local_day_reached(offer_id_param) then
    raise exception 'You can mark this as completed on the day of the visit.';
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
