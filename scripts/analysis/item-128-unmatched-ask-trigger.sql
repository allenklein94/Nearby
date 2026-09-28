-- Item 128 revisit trigger (owner, 2026-09-28, LOCKED). Read-only; structured fields only (never raw_text).
-- Run weekly (Management API / service role). Eligible ask = a typed ask in intent_submissions that is not a
-- business-partnership proposal (same rule as Match Radar and category_trends). Unmatched = had_any_result = false.
-- Trigger if, over the rolling 28 days ending at the evaluation time, EITHER
--   primary: unmatched asks >= 10% of eligible asks AND >= 100 distinct people submitted eligible asks, OR
--   volume:  >= 50 distinct people had an unmatched ask;
-- and it holds at two consecutive weekly evaluations (this query returns this week and the week before).
-- Tripping it only means: revisit whether canonical tags, the business-side emerging-category loop and the admin synonym
-- tools cover demand. It does NOT authorize reading raw phrases or building an unmatched-phrase report.
with evals as (
  select now() as eval_at, 'this_week' as evaluation
  union all select now() - interval '7 days', 'previous_week'
),
w as (
  select e.evaluation, e.eval_at,
         count(s.id) as eligible_asks,
         count(s.id) filter (where s.had_any_result = false) as unmatched_asks,
         count(distinct s.user_id) as eligible_people,
         count(distinct s.user_id) filter (where s.had_any_result = false) as unmatched_people
  from evals e
  left join intent_submissions s
    on s.created_at > e.eval_at - interval '28 days' and s.created_at <= e.eval_at
   and s.intent_kind is distinct from 'business_partner'
  group by e.evaluation, e.eval_at
)
select evaluation, eval_at, eligible_asks, unmatched_asks, eligible_people, unmatched_people,
       round(100.0 * unmatched_asks / nullif(eligible_asks, 0), 1) as unmatched_pct,
       (unmatched_asks >= 0.10 * eligible_asks and eligible_asks > 0 and eligible_people >= 100) as primary_met,
       (unmatched_people >= 50) as volume_met,
       bool_and(unmatched_asks >= 0.10 * eligible_asks and eligible_asks > 0 and eligible_people >= 100 or unmatched_people >= 50)
         over () as revisit_triggered
from w
order by eval_at desc;
