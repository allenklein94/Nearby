-- 10/10 roadmap Part 5: business marketplace reliability (see CLAUDE.md's
-- "10/10 roadmap" plan). Two real, public-safe aggregate RPCs over a
-- partner's own past business_request_offers rows -- no ownership check
-- needed (same posture as get_business_follower_count: only real,
-- already-aggregated counts/percentages of a business's own past
-- behavior, no PII, no other users' free text). Both return null/zero-
-- safe results for a partner with no history yet -- never a fabricated
-- "usually fast!" placeholder.

-- Real median response time, in minutes, across every offer this partner
-- has ever actually responded to (submit_business_offer/
-- decline_business_offer both stamp responded_at -- a null responded_at
-- means "never responded," correctly excluded from this median rather
-- than counted as an instant response).
create or replace function public.get_partner_avg_response_time(partner_id_param uuid)
returns table (
  median_response_minutes numeric,
  response_sample_size bigint
)
language sql
security definer
set search_path = public
as $$
  select
    round(cast(percentile_cont(0.5) within group (order by extract(epoch from (responded_at - created_at)) / 60.0) as numeric), 0),
    count(*)
  from business_request_offers
  where partner_id = partner_id_param
    and responded_at is not null;
$$;

revoke all on function public.get_partner_avg_response_time(uuid) from public, anon;
grant execute on function public.get_partner_avg_response_time(uuid) to authenticated;

-- Response rate (did they respond at all, offer or decline), acceptance
-- rate (of the ones they responded to, how many did the consumer pick),
-- completion rate (of the ones the consumer picked, how many actually
-- happened) -- three real, distinct funnel stages, each null-safe against
-- a zero denominator.
create or replace function public.get_partner_offer_reputation(partner_id_param uuid)
returns table (
  total_opportunities bigint,
  responded_count bigint,
  response_rate numeric,
  accepted_count bigint,
  acceptance_rate numeric,
  completed_count bigint,
  completion_rate numeric
)
language sql
security definer
set search_path = public
as $$
  select
    count(*),
    count(*) filter (where responded_at is not null),
    round(100.0 * count(*) filter (where responded_at is not null) / nullif(count(*), 0), 1),
    count(*) filter (where status in ('accepted', 'completed')),
    round(100.0 * count(*) filter (where status in ('accepted', 'completed')) / nullif(count(*) filter (where responded_at is not null), 0), 1),
    count(*) filter (where status = 'completed'),
    round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1)
  from business_request_offers
  where partner_id = partner_id_param;
$$;

revoke all on function public.get_partner_offer_reputation(uuid) from public, anon;
grant execute on function public.get_partner_offer_reputation(uuid) to authenticated;
