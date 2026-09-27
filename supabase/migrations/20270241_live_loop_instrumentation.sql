-- Live-loop instrumentation, the three last gaps before the live-market pass (2026-09-27, owner). Observability only.
--   1. No-show: a business can mark "Didn't show up" on a confirmed visit once its time has passed. Analysis only: it changes no
--      offer / reservation / plan status, sends nothing, and never penalizes or is shown to the customer. It blocks a later
--      "completed" so the two outcomes can never both be true.
--   2. Area bucket: business_requests.area_key, a ~10-mile grid cell (request_area_key),
--      stamped by the server from the request's own coordinates. Analysis reads the bucket, never the coordinates.
--   3. request_journey: ONE internal view, one row per business request: typed ask -> interpretation -> results shown ->
--      business candidates (chosen / excluded) -> request -> offers -> acceptance -> reservation -> completed / no-show /
--      cancelled. No client or business grants.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. No-show
-- ---------------------------------------------------------------------------------------------------------------------------
create table if not exists public.business_visit_no_shows (
  offer_id uuid primary key references public.business_request_offers (id) on delete cascade,
  reservation_id uuid references public.business_reservations (id) on delete set null,
  request_id uuid not null references public.business_requests (id) on delete cascade,
  partner_id uuid not null,
  visit_at timestamptz not null,
  marked_by uuid,
  marked_at timestamptz not null default now()
);
alter table public.business_visit_no_shows enable row level security;
revoke all on public.business_visit_no_shows from public, anon, authenticated;

-- When the visit begins, as known from the data, never guessed: the accepted alternative time, else the gathering's start, else
-- the request's date + start time in the requester's own (non-UTC) timezone, else the END of the request's date. With no known
-- timezone the date is read at UTC-12, the last place on earth, so a visit can never count as passed before it locally has.
-- No date at all = null (a no-show cannot be marked).
create or replace function public._visit_starts_at(offer_id_param uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    o.proposed_time,
    g.scheduled_at,
    case when r.date is not null then
      case when r.time_window_start is not null then (r.date + r.time_window_start)
           else (r.date + 1)::timestamp end
      at time zone coalesce(nullif(nullif(p.timezone, ''), 'UTC'), 'Etc/GMT+12')
    end)
  from business_request_offers o
  join business_requests r on r.id = o.request_id
  left join gatherings g on g.id = r.gathering_id
  left join profiles p on p.id = r.requester_id
  where o.id = offer_id_param
$$;
revoke all on function public._visit_starts_at(uuid) from public, anon, authenticated;

create or replace function public.mark_business_no_show(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
  v_reservation record;
  v_partner uuid;
  v_visit timestamptz;
begin
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_partner is null or v_partner <> v_offer.partner_id then
    raise exception 'This visit is not one of yours.';
  end if;
  if exists (select 1 from business_visit_no_shows where offer_id = offer_id_param) then
    return jsonb_build_object('marked', false, 'already', true);
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'Only a confirmed visit that was not completed can be marked as a no-show.';
  end if;
  select * into v_reservation from business_reservations where offer_id = offer_id_param;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'Only a confirmed visit that was not completed can be marked as a no-show.';
  end if;
  v_visit := _visit_starts_at(offer_id_param);
  if v_visit is null then
    raise exception 'This visit has no time on record, so it cannot be marked as a no-show.';
  end if;
  if now() < v_visit then
    raise exception 'You can mark a no-show once the visit time has passed.';
  end if;
  insert into business_visit_no_shows (offer_id, reservation_id, request_id, partner_id, visit_at, marked_by)
  values (offer_id_param, v_reservation.id, v_offer.request_id, v_offer.partner_id, v_visit, auth.uid());
  return jsonb_build_object('marked', true);
end;
$$;
revoke all on function public.mark_business_no_show(uuid) from public, anon;
grant execute on function public.mark_business_no_show(uuid) to authenticated;

-- The owner's own marked visits (offer ids only), so the dashboard can show the row as marked.
create or replace function public.get_my_business_no_shows()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select n.offer_id from business_visit_no_shows n
  where n.partner_id = (select managed_partner_id from profiles where id = auth.uid())
$$;
revoke all on function public.get_my_business_no_shows() from public, anon;
grant execute on function public.get_my_business_no_shows() to authenticated;

-- Completion refuses a visit already marked as a no-show (same message as any other not-completable state, never "no-show").
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
revoke all on function public.complete_business_reservation(uuid) from public, anon;
grant execute on function public.complete_business_reservation(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Area bucket: ~10-mile grid cells (the same cell size the product already uses for local areas; a test keeps the formula
--    equal to that grid). Kept separate from the sponsored system on purpose: organic code never references it.
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.business_requests add column if not exists area_key text;

create or replace function public.request_area_key(lat double precision, lng double precision)
returns text language sql immutable as $$
  select floor(lat / 0.145)::bigint::text || ':' || floor(lng / 0.19)::bigint::text;
$$;
revoke all on function public.request_area_key(double precision, double precision) from public, anon, authenticated;

create or replace function public._stamp_request_area_key()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Always the server's own value from the request's coordinates; anything a client sends is replaced.
  new.area_key := case when new.latitude is not null and new.longitude is not null
    then request_area_key(new.latitude, new.longitude) end;
  return new;
end;
$$;
revoke all on function public._stamp_request_area_key() from public, anon, authenticated;
drop trigger if exists business_requests_area_key on public.business_requests;
create trigger business_requests_area_key
  before insert or update of latitude, longitude, area_key on public.business_requests
  for each row execute function public._stamp_request_area_key();

update public.business_requests set area_key = request_area_key(latitude, longitude)
where latitude is not null and longitude is not null and area_key is distinct from request_area_key(latitude, longitude);

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. The chain: the per-candidate view gains no_show, and one row per request answers "what happened to this request?"
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace view public.routing_candidate_outcomes as
 SELECT d.id AS decision_id, d.request_id, d.path, d.rules_version, d.created_at AS decided_at, c.partner_id,
    c.outcome AS routing_outcome, c.rank, c.primary_reason, c.reason_codes, c.signals, o.id AS offer_id, o.status AS offer_status,
    o.created_at AS offer_created_at, o.responded_at, o.accepted_at, o.completed_at, o.cancelled_at, o.decline_reason,
    r.status AS request_status, res.status AS reservation_status,
    ( SELECT ce.reason_code FROM cancellation_events ce
       WHERE (((ce.entity_type = 'business_reservation'::text) AND (ce.entity_id = res.id)) OR ((ce.entity_type = 'business_request'::text) AND (ce.entity_id = d.request_id)))
       ORDER BY ce.created_at DESC LIMIT 1) AS cancellation_reason,
    ( SELECT oo.match_fit FROM business_offer_outcomes oo WHERE (oo.offer_id = o.id) ORDER BY oo.created_at DESC LIMIT 1) AS match_fit,
    CASE
      WHEN (c.outcome = 'excluded'::text) THEN 'not_routed'::text
      WHEN (o.id IS NULL) THEN 'no_offer_row'::text
      WHEN (o.status = 'completed'::text) THEN 'completed'::text
      WHEN (o.status = 'accepted'::text AND EXISTS (SELECT 1 FROM business_visit_no_shows n WHERE n.offer_id = o.id)) THEN 'no_show'::text
      WHEN (o.status = 'accepted'::text) THEN 'accepted'::text
      WHEN (o.status = 'offered'::text) THEN 'offer_sent'::text
      WHEN ((o.status = 'pending'::text) AND (r.status = 'open'::text)) THEN 'awaiting_business'::text
      WHEN (o.status = 'pending'::text) THEN 'no_response'::text
      ELSE o.status
    END AS chain_outcome
   FROM ((((routing_decisions d
     JOIN routing_candidates c ON ((c.decision_id = d.id)))
     JOIN business_requests r ON ((r.id = d.request_id)))
     LEFT JOIN business_request_offers o ON (((o.request_id = d.request_id) AND (o.partner_id = c.partner_id))))
     LEFT JOIN business_reservations res ON ((res.offer_id = o.id)));
revoke all on public.routing_candidate_outcomes from public, anon, authenticated;

create or replace view public.request_journey as
select
  r.id as request_id,
  r.created_at as requested_at,
  r.status as request_status,
  r.area_key,
  r.category, r.occasion, r.party_size, r.date, r.time_window_start, r.budget_max, r.radius_miles,
  (r.target_partner_id is not null) as targeted,
  case when r.gathering_id is not null then 'gathering' when r.match_id is not null then 'match' when r.community_id is not null then 'community'
       when r.group_plan_id is not null then 'group_plan' when r.parent_request_id is not null then 'addon' else 'solo' end as request_source,
  -- the typed ask it came from (its original snapshot, never a refinement) and what that ask showed
  r.submission_id,
  ask.id as ask_snapshot_id,
  ask.surface as ask_surface,
  ask.created_at as asked_at,
  ask.interpretation as ask_interpretation,
  ask.result_count as ask_results_shown,
  (select count(*) from typed_ask_snapshots s2 where s2.parent_snapshot_id = ask.id) as ask_refinements,
  (select min(tr.position) from typed_ask_results tr where tr.snapshot_id = ask.id and tr.partner_id = r.target_partner_id) as targeted_business_shown_at,
  -- routing: every decision, the candidates it considered, chosen and excluded
  (select count(*) from routing_decisions d where d.request_id = r.id) as routing_decisions,
  (select sum(d.considered_count) from routing_decisions d where d.request_id = r.id) as candidates_considered,
  (select sum(d.chosen_count) from routing_decisions d where d.request_id = r.id) as candidates_chosen,
  (select jsonb_object_agg(x.reason, x.n) from (
     select c.primary_reason as reason, count(*) as n from routing_decisions d join routing_candidates c on c.decision_id = d.id
     where d.request_id = r.id and c.outcome = 'excluded' group by c.primary_reason) x) as excluded_by_reason,
  (select jsonb_agg(jsonb_build_object('partner_id', c.partner_id, 'path', d.path, 'rank', c.rank, 'distance_miles', c.distance_miles,
     'signals', c.signals) order by d.created_at, c.rank)
     from routing_decisions d join routing_candidates c on c.decision_id = d.id
     where d.request_id = r.id and c.outcome = 'chosen') as chosen_businesses,
  -- offers
  (select count(*) from business_request_offers o where o.request_id = r.id) as offers_total,
  (select count(*) from business_request_offers o where o.request_id = r.id and o.responded_at is not null) as offers_answered,
  (select jsonb_object_agg(x.status, x.n) from (select o.status, count(*) as n from business_request_offers o where o.request_id = r.id group by o.status) x) as offers_by_status,
  (select jsonb_object_agg(x.reason, x.n) from (select o.decline_reason as reason, count(*) as n from business_request_offers o
     where o.request_id = r.id and o.decline_reason is not null group by o.decline_reason) x) as declines_by_reason,
  (select min(o.responded_at) from business_request_offers o where o.request_id = r.id) as first_response_at,
  -- the booking (the accepted or completed offer), and how it ended
  win.id as booked_offer_id,
  win.partner_id as booked_partner_id,
  win.accepted_at,
  (select c.distance_miles from routing_decisions d join routing_candidates c on c.decision_id = d.id
     where d.request_id = r.id and c.partner_id = win.partner_id order by d.created_at limit 1) as booked_distance_miles,
  res.status as reservation_status,
  win.completed_at,
  ns.marked_at as no_show_marked_at,
  (select ce.reason_code from cancellation_events ce
     where (ce.entity_type = 'business_reservation' and ce.entity_id = res.id) or (ce.entity_type = 'business_request' and ce.entity_id = r.id)
     order by ce.created_at desc limit 1) as cancellation_reason,
  (select oo.match_fit from business_offer_outcomes oo where oo.offer_id = win.id order by oo.created_at desc limit 1) as match_fit,
  case
    when win.status = 'completed' then 'completed'
    when ns.offer_id is not null then 'no_show'
    when win.id is not null and (win.status = 'cancelled' or res.status = 'cancelled') then 'reservation_cancelled'
    when win.id is not null then 'booked'
    when r.status = 'cancelled' then 'request_cancelled'
    when r.status = 'merged' then 'merged'
    when r.status = 'expired' and exists (select 1 from business_request_offers o where o.request_id = r.id and o.status in ('offered', 'expired') and o.responded_at is not null) then 'expired_with_offers'
    when r.status = 'expired' then 'expired_no_offer'
    when exists (select 1 from business_request_offers o where o.request_id = r.id and o.status = 'offered') then 'offers_waiting'
    when exists (select 1 from business_request_offers o where o.request_id = r.id and o.status = 'pending') then 'awaiting_business'
    when not exists (select 1 from business_request_offers o where o.request_id = r.id) then 'not_routed'
    else 'all_declined'
  end as journey_outcome
from business_requests r
left join lateral (
  select s.* from typed_ask_snapshots s
  where r.submission_id is not null and s.submission_id = r.submission_id and s.parent_snapshot_id is null
  order by s.created_at limit 1
) ask on true
left join lateral (
  -- the offer the customer accepted (still booked, completed, or cancelled after booking)
  select o.* from business_request_offers o where o.request_id = r.id and o.accepted_at is not null
  order by (o.status in ('accepted', 'completed')) desc, o.accepted_at desc limit 1
) win on true
left join business_reservations res on res.offer_id = win.id
left join business_visit_no_shows ns on ns.offer_id = win.id;
revoke all on public.request_journey from public, anon, authenticated;
