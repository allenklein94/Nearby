-- Nearby 2.0 vision layer 2, "The intent graph / learning system" (see
-- CLAUDE.md's "Nearby 2.0 Vision" doc). The vision doc itself is explicit
-- that this is "the slowest-maturing layer... not a build question yet"
-- until there's real volume to learn a pattern from -- so this is
-- deliberately NOT a trained model, a fabricated "understanding," or
-- anything that pretends to know something this schema doesn't actually
-- have yet. What it IS: the real, honest cross-user aggregation
-- infrastructure the doc's own text describes as the raw material a
-- graph would eventually be built from -- "every submission is
-- structured signal... over enough volume this becomes a real model."
-- This builds the "over enough volume" part for real, gated on a real
-- minimum sample size, same "build the instrumentation, be honest the
-- numbers don't exist yet" convention as every other Market Validation
-- dashboard section.
--
-- Distinct from intentPatterns.js's own existing per-user pattern
-- detection (Home's smarter placeholder text, 10/10 roadmap Part 7) --
-- that's one user's own history; this is the same real
-- (category, day-of-week-bucketed-period) grouping applied ACROSS every
-- user's real intent_submissions rows at once, which is what makes this
-- a genuine cross-user signal rather than a personalization feature.
-- Reuses getTimePeriod()'s exact real bucketing rule (weekend if
-- Sat/Sun, else morning/afternoon/evening by hour) in SQL, not a new
-- invented time bucketing scheme.
--
-- Admin-only (same check_is_admin gate as every other Market Validation
-- RPC) -- this rolls up other users' real submitted text/behavior across
-- the whole platform, a different exposure question than one person's
-- own resolved intent. Silent below a real double threshold: at least 10
-- real submissions AND at least 3 distinct real users in the bucket --
-- the second guard specifically so one person submitting the same ask
-- ten times in a loop can never be mistaken for a genuine cross-user
-- pattern.
create or replace function public.get_cross_user_intent_patterns()
returns table (
  category text,
  period text,
  submission_count bigint,
  distinct_users bigint,
  pct_with_result numeric,
  pct_reached_fallback numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view cross-user intent patterns';
  end if;

  return query
  select
    s.category,
    bucketed.period,
    count(*) as submission_count,
    count(distinct s.user_id) as distinct_users,
    round(100.0 * count(*) filter (where s.had_any_result) / nullif(count(*), 0), 1) as pct_with_result,
    round(100.0 * count(*) filter (where s.reached_business_fallback) / nullif(count(*), 0), 1) as pct_reached_fallback
  from intent_submissions s
  cross join lateral (
    select case
      when extract(dow from s.created_at) in (0, 6) then 'weekend'
      when extract(hour from s.created_at) < 12 then 'morning'
      when extract(hour from s.created_at) < 18 then 'afternoon'
      else 'evening'
    end as period
  ) bucketed
  where s.category is not null
  group by s.category, bucketed.period
  having count(*) >= 10 and count(distinct s.user_id) >= 3
  order by count(*) desc
  limit 20;
end;
$$;

revoke all on function public.get_cross_user_intent_patterns() from public, anon;
grant execute on function public.get_cross_user_intent_patterns() to authenticated;
