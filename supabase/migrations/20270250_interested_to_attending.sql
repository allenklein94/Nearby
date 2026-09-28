-- Item 126 follow-up (2026-09-28, owner decision): Interested -> Attending becomes measurable, business-request attribution stays
-- conservative (unchanged: only a request carrying the ask's own submission id is the ask's; nothing is inferred).
--
-- Joining a gathering deletes the person's Interested mark (clear_interested_on_join, item 37 behavior, unchanged: a person who
-- joined is NOT currently Interested). The same trigger now first keeps ONE private fact, "was Interested since X, joined at Y",
-- in gathering_interested_joins: no new event, client call or tracking path; one row per person per gathering; nothing reads
-- it except the internal funnel. Attending itself still comes from gathering_interest (the canonical join record).
-- A mark the person REMOVES without joining is not kept (their own retraction erases it, as before).
-- Privacy/retention: RLS on, no grants to anon/authenticated (never readable by the person, businesses or anyone else in the
-- app); rows cascade away with the gathering or the account.

create table if not exists public.gathering_interested_joins (
  gathering_id uuid not null references public.gatherings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  interested_at timestamptz not null,
  joined_at timestamptz not null default now(),
  primary key (gathering_id, user_id)
);
alter table public.gathering_interested_joins enable row level security;
revoke all on public.gathering_interested_joins from public, anon, authenticated;

create or replace function public.clear_interested_on_join()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- keep the fact that this person was Interested before joining (internal analysis only), then clear the mark as before
  insert into gathering_interested_joins (gathering_id, user_id, interested_at, joined_at)
  select gi.gathering_id, gi.user_id, gi.created_at, now()
  from gathering_interested gi where gi.gathering_id = new.gathering_id and gi.user_id = new.user_id
  on conflict (gathering_id, user_id) do nothing;
  delete from gathering_interested where gathering_id = new.gathering_id and user_id = new.user_id;
  return new;
end;
$function$;
revoke all on function public.clear_interested_on_join() from public, anon, authenticated;

-- the funnel: interested_at now means "ever Interested" (current mark or kept before a join); two columns added at the end:
-- interested_now (current state) and interested_then_attending_at. The summary is recreated for its new columns.
drop view if exists public.intent_funnel_summary;

create or replace view public.intent_funnel as
with asks as (
  select distinct on (coalesce(s.submission_id, s.id)) s.id, s.user_id, s.submission_id, s.surface, s.rules_version,
         s.created_at, s.interpretation
  from public.typed_ask_snapshots s
  where s.parent_snapshot_id is null
  order by coalesce(s.submission_id, s.id), s.created_at, s.id
),
fam as (
  -- every snapshot of the ask: the original, its refinements, and (by submission) any retried copy of it
  select a.id as ask_id, s.id as snapshot_id, s.created_at
  from asks a
  join public.typed_ask_snapshots s
    on s.id = a.id or s.parent_snapshot_id = a.id or (a.submission_id is not null and s.submission_id = a.submission_id)
),
req as (
  select a.id as ask_id, br.id as request_id, br.created_at
  from asks a
  join public.business_requests br on a.submission_id is not null and br.submission_id = a.submission_id and br.requester_id = a.user_id
)
select
  a.id as ask_snapshot_id,
  a.submission_id,
  a.surface,
  a.rules_version,
  a.created_at as asked_at,
  date_trunc('week', a.created_at)::date as ask_week,
  sub.wide_area as ask_area,
  coalesce(a.interpretation->>'category', sub.category) as category,
  (select count(*) from fam f where f.ask_id = a.id and f.snapshot_id <> a.id) as refinements,
  -- shown
  (select min(f.created_at) from fam f where f.ask_id = a.id
     and exists (select 1 from public.typed_ask_results r where r.snapshot_id = f.snapshot_id)) as shown_at,
  exists (select 1 from fam f join public.typed_ask_results r on r.snapshot_id = f.snapshot_id
     where f.ask_id = a.id and r.result_type = 'gathering') as showed_gathering,
  -- viewed (a tap on a shown result)
  (select min(o.selected_at) from public.intent_outcomes o
     where o.user_id = a.user_id
       and (o.snapshot_id in (select f.snapshot_id from fam f where f.ask_id = a.id)
         or (o.snapshot_id is null and a.submission_id is not null and o.submission_id = a.submission_id))) as viewed_at,
  -- interested (private; internal aggregate use only): EVER marked Interested after the ask on a gathering it showed, whether
  -- the mark is still there or was turned into a join (gathering_interested_joins keeps that fact)
  (select min(x.at) from (
     select gi.created_at as at, gi.gathering_id from public.gathering_interested gi where gi.user_id = a.user_id
     union all
     select j.interested_at, j.gathering_id from public.gathering_interested_joins j where j.user_id = a.user_id) x
   where x.at >= a.created_at
     and x.gathering_id::text in (select r.result_id from fam f join public.typed_ask_results r on r.snapshot_id = f.snapshot_id
                                     where f.ask_id = a.id and r.result_type = 'gathering')) as interested_at,
  -- attending
  (select min(g.created_at) from public.gathering_interest g
     where g.user_id = a.user_id and g.status = 'approved' and g.created_at >= a.created_at
       and g.gathering_id::text in (select r.result_id from fam f join public.typed_ask_results r on r.snapshot_id = f.snapshot_id
                                    where f.ask_id = a.id and r.result_type = 'gathering')) as attending_at,
  -- business side
  (select min(q.created_at) from req q where q.ask_id = a.id) as business_requested_at,
  (select count(*) from req q where q.ask_id = a.id) as requests,
  least(
    (select min(bo.responded_at) from req q join public.business_request_offers bo on bo.request_id = q.request_id
       where q.ask_id = a.id and bo.responded_at is not null and bo.status <> 'declined'),
    (select min(e.created_at) from req q join public.business_request_offers bo on bo.request_id = q.request_id
       join public.domain_events e on e.object_kind = 'business_request_offer' and e.object_id = bo.id and e.type = 'BUSINESS_OFFER_SENT'
       where q.ask_id = a.id)) as offer_received_at,
  least(
    (select min(bo.accepted_at) from req q join public.business_request_offers bo on bo.request_id = q.request_id
       where q.ask_id = a.id),
    (select min(e.created_at) from req q join public.business_request_offers bo on bo.request_id = q.request_id
       join public.domain_events e on e.object_kind = 'business_request_offer' and e.object_id = bo.id and e.type = 'BUSINESS_OFFER_ACCEPTED'
       where q.ask_id = a.id)) as offer_accepted_at,
  least(
    (select min(bo.completed_at) from req q join public.business_request_offers bo on bo.request_id = q.request_id
       where q.ask_id = a.id and bo.status = 'completed'),
    (select min(e.created_at) from req q join public.business_request_offers bo on bo.request_id = q.request_id
       join public.domain_events e on e.object_kind = 'business_request_offer' and e.object_id = bo.id and e.type = 'OFFER_REDEEMED'
       where q.ask_id = a.id)) as redeemed_at,
  -- how the ask's furthest request ended (request_journey's own outcome), null when no request was made
  (select j.journey_outcome from req q join public.request_journey j on j.request_id = q.request_id
     where q.ask_id = a.id
     order by array_position(array['completed','no_show','booked','reservation_cancelled','offers_waiting','expired_with_offers',
       'awaiting_business','all_declined','expired_no_offer','request_cancelled','merged','not_routed'], j.journey_outcome), q.created_at
     limit 1) as request_outcome,
  -- current state: still marked Interested (not joined) on a gathering the ask showed
  exists (select 1 from public.gathering_interested gi
     where gi.user_id = a.user_id and gi.created_at >= a.created_at
       and gi.gathering_id::text in (select r.result_id from fam f join public.typed_ask_results r on r.snapshot_id = f.snapshot_id
                                     where f.ask_id = a.id and r.result_type = 'gathering')) as interested_now,
  -- Interested -> Attending: marked Interested after the ask, then that same gathering's join is now approved
  (select min(g.created_at) from public.gathering_interested_joins j
     join public.gathering_interest g on g.gathering_id = j.gathering_id and g.user_id = j.user_id and g.status = 'approved'
     where j.user_id = a.user_id and j.interested_at >= a.created_at
       and j.gathering_id::text in (select r.result_id from fam f join public.typed_ask_results r on r.snapshot_id = f.snapshot_id
                                     where f.ask_id = a.id and r.result_type = 'gathering')) as interested_then_attending_at
from asks a
left join public.intent_submissions sub on sub.id = a.submission_id;

revoke all on public.intent_funnel from public, anon, authenticated;

create or replace view public.intent_funnel_summary as
with f as (
  select *, coalesce(ask_area, 'unknown') as area_v, coalesce(category, 'unknown') as category_v from public.intent_funnel
),
g as (
  select
    case when grouping(area_v) = 0 then 'area' when grouping(category_v) = 0 then 'category'
         when grouping(ask_week) = 0 then 'week' else 'overall' end as dimension,
    coalesce(case when grouping(area_v) = 0 then area_v end, case when grouping(category_v) = 0 then category_v end,
             case when grouping(ask_week) = 0 then ask_week::text end, 'all') as value,
    count(*) as asks,
    count(*) filter (where shown_at is not null) as shown,
    count(*) filter (where shown_at is not null and viewed_at is not null) as viewed,
    count(*) filter (where showed_gathering) as showed_gathering,
    count(*) filter (where showed_gathering and interested_at is not null) as interested,
    count(*) filter (where showed_gathering and attending_at is not null) as attending,
    count(*) filter (where showed_gathering and interested_now) as interested_now,
    count(*) filter (where showed_gathering and interested_at is not null and interested_then_attending_at is not null) as interested_then_attending,
    count(*) filter (where business_requested_at is not null) as business_requested,
    count(*) filter (where business_requested_at is not null and offer_received_at is not null) as offer_received,
    count(*) filter (where offer_received_at is not null and offer_accepted_at is not null) as offer_accepted,
    count(*) filter (where offer_accepted_at is not null and redeemed_at is not null) as redeemed
  from f
  group by grouping sets ((), (area_v), (category_v), (ask_week))
)
select g.*,
  round(shown::numeric / nullif(asks, 0), 4) as shown_rate,
  round(viewed::numeric / nullif(shown, 0), 4) as viewed_rate,
  round(interested::numeric / nullif(showed_gathering, 0), 4) as interested_rate,
  round(attending::numeric / nullif(showed_gathering, 0), 4) as attending_rate,
  round(interested_then_attending::numeric / nullif(interested, 0), 4) as interested_to_attending_rate,
  round(business_requested::numeric / nullif(asks, 0), 4) as business_requested_rate,
  round(offer_received::numeric / nullif(business_requested, 0), 4) as offer_received_rate,
  round(offer_accepted::numeric / nullif(offer_received, 0), 4) as offer_accepted_rate,
  round(redeemed::numeric / nullif(offer_accepted, 0), 4) as redeemed_rate,
  round(1 - shown::numeric / nullif(asks, 0), 4) as shown_drop_off,
  round(1 - viewed::numeric / nullif(shown, 0), 4) as viewed_drop_off,
  round(1 - offer_received::numeric / nullif(business_requested, 0), 4) as offer_received_drop_off,
  round(1 - offer_accepted::numeric / nullif(offer_received, 0), 4) as offer_accepted_drop_off,
  round(1 - redeemed::numeric / nullif(offer_accepted, 0), 4) as redeemed_drop_off
from g;

revoke all on public.intent_funnel_summary from public, anon, authenticated;
