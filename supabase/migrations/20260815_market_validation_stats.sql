-- 10/10 roadmap Part 9: market validation dashboard (see CLAUDE.md's
-- "10/10 roadmap" plan). Depends on Parts 1-2's real intent_submissions/
-- intent_outcomes tables and Part 5's partner reliability math -- every
-- number here is a real query result, never a placeholder/target. This
-- app is young with little real usage, so most of these will read as
-- honest, near-zero numbers for a long while -- that's the correct,
-- honest state per the plan's own explicit framing, not a bug to hide.

-- Real 7/30-day return rate: of everyone who has ever submitted a real
-- intent (intent_submissions), what fraction came back and submitted
-- again at least 7/30 real days after their first submission. Uses
-- intent_submissions as the activity signal since it's the one real,
-- already-instrumented cross-session usage event this app has (Part 2) --
-- not a fabricated "session" or "login" concept this schema doesn't
-- actually track anywhere.
--
-- Real marketplace-wide partner reliability: the exact same three funnel
-- stages get_partner_offer_reputation() (Part 5) already computes for one
-- partner, aggregated here across every partner's business_request_offers
-- rows at once -- a market-wide view of "do businesses on this platform
-- actually respond/get picked/follow through," not a per-partner detail.
create or replace function public.get_market_validation_stats()
returns table (
  distinct_submitters bigint,
  returned_7d bigint,
  return_rate_7d numeric,
  returned_30d bigint,
  return_rate_30d numeric,
  partners_with_opportunities bigint,
  total_opportunities bigint,
  responded_count bigint,
  response_rate numeric,
  accepted_count bigint,
  acceptance_rate numeric,
  completed_count bigint,
  completion_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view market validation stats';
  end if;

  return query
  with per_user as (
    select user_id, min(created_at) as first_at, max(created_at) as last_at
    from intent_submissions
    group by user_id
  )
  select
    (select count(*) from per_user),
    (select count(*) from per_user where last_at >= first_at + interval '7 days'),
    round(100.0 * (select count(*) from per_user where last_at >= first_at + interval '7 days') / nullif((select count(*) from per_user), 0), 1),
    (select count(*) from per_user where last_at >= first_at + interval '30 days'),
    round(100.0 * (select count(*) from per_user where last_at >= first_at + interval '30 days') / nullif((select count(*) from per_user), 0), 1),
    (select count(distinct partner_id) from business_request_offers),
    (select count(*) from business_request_offers),
    (select count(*) from business_request_offers where responded_at is not null),
    round(100.0 * (select count(*) from business_request_offers where responded_at is not null) / nullif((select count(*) from business_request_offers), 0), 1),
    (select count(*) from business_request_offers where status in ('accepted', 'completed')),
    round(100.0 * (select count(*) from business_request_offers where status in ('accepted', 'completed')) / nullif((select count(*) from business_request_offers where responded_at is not null), 0), 1),
    (select count(*) from business_request_offers where status = 'completed'),
    round(100.0 * (select count(*) from business_request_offers where status = 'completed') / nullif((select count(*) from business_request_offers where status in ('accepted', 'completed')), 0), 1);
end;
$$;

revoke all on function public.get_market_validation_stats() from public, anon;
grant execute on function public.get_market_validation_stats() to authenticated;
