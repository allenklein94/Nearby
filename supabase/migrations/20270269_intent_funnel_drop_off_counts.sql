-- Owner follow-up to item 126 (2026-10-03): "drop-off" must read as a COUNT, never be mistaken for a percentage.
-- intent_funnel_summary's old *_drop_off columns were fractions (1 - rate) under a name that reads like a count. They are
-- replaced by drop_off_before_<next stage> = people who reached a stage and did NOT reach the next one (a count). The
-- *_rate columns are unchanged (each over the population that actually reached the previous stage). A drop-off is given
-- only between stages that are nested (everyone at the next stage passed the one before), so it can never be negative.
-- Not nested, so no drop-off is given: attending vs interested (a person can attend a gathering without marking it
-- Interested); attending_rate stays over gathering-shown asks.
--
-- intent_funnel_stages: the same numbers as one row per stage, "Stage | Reached | Drop-off before next stage", in three
-- chains (each chain is nested; a chain's last stage has no drop-off):
--   ask:       Typed asks -> Recommendations shown -> Result opened   (opened = any result tapped; no separate
--              "gathering opened" exists and none is invented)
--   gathering: Gathering shown -> Interested -> Attending after Interested
--   business:  Typed asks -> Business request -> Offer received -> Offer accepted -> Redeemed
-- Same counts, same scope (typed asks only, request attribution by the ask's own id), internal only like the summary.
drop view if exists public.intent_funnel_stages;
drop view if exists public.intent_funnel_summary;

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
  asks - shown as drop_off_before_shown,
  shown - viewed as drop_off_before_viewed,
  showed_gathering - interested as drop_off_before_interested,
  interested - interested_then_attending as drop_off_before_attending_after_interested,
  asks - business_requested as drop_off_before_business_request,
  business_requested - offer_received as drop_off_before_offer_received,
  offer_received - offer_accepted as drop_off_before_offer_accepted,
  offer_accepted - redeemed as drop_off_before_redeemed
from g;

revoke all on public.intent_funnel_summary from public, anon, authenticated;

create or replace view public.intent_funnel_stages as
with s as (
  select dimension, value, chain, stage_order, stage, reached
  from public.intent_funnel_summary,
  lateral (values
    ('ask', 1, 'Typed asks', asks),
    ('ask', 2, 'Recommendations shown', shown),
    ('ask', 3, 'Result opened', viewed),
    ('gathering', 1, 'Gathering shown', showed_gathering),
    ('gathering', 2, 'Interested', interested),
    ('gathering', 3, 'Attending after Interested', interested_then_attending),
    ('business', 1, 'Typed asks', asks),
    ('business', 2, 'Business request', business_requested),
    ('business', 3, 'Offer received', offer_received),
    ('business', 4, 'Offer accepted', offer_accepted),
    ('business', 5, 'Redeemed', redeemed)
  ) v(chain, stage_order, stage, reached)
)
select dimension, value, chain, stage_order, stage, reached,
  reached - lead(reached) over w as drop_off_before_next_stage,
  lead(stage) over w as next_stage
from s
window w as (partition by dimension, value, chain order by stage_order);

revoke all on public.intent_funnel_stages from public, anon, authenticated;
