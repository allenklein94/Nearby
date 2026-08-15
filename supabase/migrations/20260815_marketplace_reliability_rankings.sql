-- Nearby 2.0 vision layer 7, "Business reliability score as a real
-- differentiator" (see CLAUDE.md's "Nearby 2.0 Vision" doc). Confirmed
-- most of this layer is already real -- get_partner_avg_response_time()/
-- get_partner_offer_reputation() (10/10 roadmap Part 5) already compute
-- a genuine per-partner reliability signal, and get_market_validation_
-- stats() already rolls that up into one marketplace-wide aggregate. The
-- one real, confirmed gap this layer's own description names beyond what
-- already exists: "making it a genuinely comparative, marketplace-wide
-- signal (ranking businesses against each other on it)" -- a per-partner
-- row set, not a single blended number.
--
-- Admin-only (same check_is_admin gate as get_intent_funnel_stats/
-- get_market_validation_stats, which this sits alongside on the same
-- dashboard) -- this is comparative business-vs-business performance
-- data, a different exposure question than one partner's own public-safe
-- reputation line. Silent below 5 real opportunities per partner, same
-- established threshold formatPartnerReliabilityLine() already uses
-- client-side for the single-partner case -- a 0-of-1 "0% accepted"
-- would read as damning noise, not a real signal, for a partner who's
-- simply never gotten an opportunity yet.
create or replace function public.get_marketplace_reliability_rankings()
returns table (
  partner_id uuid,
  partner_name text,
  total_opportunities bigint,
  response_rate numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  median_response_minutes numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view marketplace reliability rankings';
  end if;

  return query
  select
    p.id,
    p.name,
    count(o.id) as total_opportunities,
    round(100.0 * count(o.id) filter (where o.responded_at is not null) / nullif(count(o.id), 0), 1) as response_rate,
    round(100.0 * count(o.id) filter (where o.status in ('accepted', 'completed')) / nullif(count(o.id) filter (where o.responded_at is not null), 0), 1) as acceptance_rate,
    round(100.0 * count(o.id) filter (where o.status = 'completed') / nullif(count(o.id) filter (where o.status in ('accepted', 'completed')), 0), 1) as completion_rate,
    round(cast(percentile_cont(0.5) within group (
      order by extract(epoch from (o.responded_at - o.created_at)) / 60.0
    ) filter (where o.responded_at is not null) as numeric), 0) as median_response_minutes
  from brand_partners p
  join business_request_offers o on o.partner_id = p.id
  group by p.id, p.name
  having count(o.id) >= 5
  order by completion_rate desc nulls last, acceptance_rate desc nulls last
  limit 20;
end;
$$;

revoke all on function public.get_marketplace_reliability_rankings() from public, anon;
grant execute on function public.get_marketplace_reliability_rankings() to authenticated;
