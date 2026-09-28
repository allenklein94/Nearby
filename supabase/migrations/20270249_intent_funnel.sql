-- Item 126 (2026-09-28, owner decision): an internal intent funnel from data Nearby already records. Analysis only.
--
-- One row per TYPED ASK (the original typed_ask_snapshots row; refinements belong to their ask; one row per submission, so
-- a retried original can never count twice) with the time each milestone was ACTUALLY reached, from existing records only:
--   intent_created      the ask (typed_ask_snapshots.created_at)
--   shown               first snapshot of the ask (or a refinement) that recorded at least one displayed result
--   viewed              first tap on one of the ask's results (intent_outcomes, by snapshot + position, else by submission)
--   interested          first private Interested on a gathering the ask showed, after the ask (gathering_interested)
--   attending           first APPROVED join of a gathering the ask showed, after the ask (gathering_interest; the join time:
--                       an approval moment is not stored)
--   business_requested  first business request made from the ask (business_requests.submission_id, same requester)
--   offer_received      first business reply that is not a decline (offer responded_at, or its BUSINESS_OFFER_SENT event)
--   offer_accepted      first accepted offer (accepted_at, or its BUSINESS_OFFER_ACCEPTED event)
--   redeemed            first completed visit (completed offer's completed_at, or its OFFER_REDEEMED event)
-- A milestone with no record is NULL, never inferred from a later one. Each milestone is a min() inside its own subquery,
-- so repeated events or several requests/offers never multiply a row. No user id, raw text or interpretation is carried;
-- the ask's category and coarse area only. Home / Discover / Gatherings feed impressions are NOT tracked and not invented.
-- Nothing is stored: both are plain views over existing tables (their own retention rules apply unchanged). No client or
-- business grants (service role / Management API only), like request_journey.

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
  -- interested (private; internal aggregate use only)
  (select min(gi.created_at) from public.gathering_interested gi
     where gi.user_id = a.user_id and gi.created_at >= a.created_at
       and gi.gathering_id::text in (select r.result_id from fam f join public.typed_ask_results r on r.snapshot_id = f.snapshot_id
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
     limit 1) as request_outcome
from asks a
left join public.intent_submissions sub on sub.id = a.submission_id;

revoke all on public.intent_funnel from public, anon, authenticated;

-- Counts and conversion per step, overall and by area / category / week. Each step's rate uses the population that could
-- reach it: shown / asks, viewed / shown, interested and attending / asks that showed a gathering, requested / asks,
-- offer received / requested, accepted / offer received, redeemed / accepted. A numerator only counts asks that are also in
-- its denominator, so a rate can never exceed 1. drop_off = 1 - rate. NULL rate = empty population.
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
