-- budget_max is the maximum spend PER PERSON and, when present, must be a real ceiling: $0 (or less) is not one.
-- NULL stays valid ("no budget specified"). NOT VALID so no existing row is rewritten or re-checked (production has
-- none <= 0 anyway); every new/updated row is enforced. budget_min keeps its own >= 0 rule.
alter table public.business_requests drop constraint if exists business_requests_budget_check;
alter table public.business_requests add constraint business_requests_budget_check check (
  (budget_min is null or budget_min >= 0)
  and (budget_max is null or budget_max > 0)
  and (budget_min is null or budget_max is null or budget_min <= budget_max)
) not valid;
