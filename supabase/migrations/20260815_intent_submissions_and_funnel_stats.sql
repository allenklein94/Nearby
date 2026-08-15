-- 10/10 roadmap Part 2: differentiation metrics (see CLAUDE.md's "10/10
-- roadmap" plan). Logs every real resolveIntent()/resolveCommunityIntent()
-- call, not just successful ones, so the funnel can honestly answer "what
-- fraction of real asks got a real result" -- every number below is a real
-- query result, never a placeholder/target.
create table if not exists public.intent_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text,
  category text,
  date_window text,
  intent_kind text,
  had_any_result boolean not null default false,
  reached_business_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  constraint intent_submissions_intent_kind_check check (intent_kind is null or intent_kind in (
    'gathering', 'community', 'business_partner', 'unclear'
  ))
);

alter table public.intent_submissions enable row level security;

create policy "Users manage their own intent submissions"
  on public.intent_submissions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists intent_submissions_user_id_idx on public.intent_submissions(user_id);
create index if not exists intent_submissions_created_at_idx on public.intent_submissions(created_at);
revoke all on public.intent_submissions from anon;

-- Real join between "a result was selected" and "which submission it came
-- from" -- nullable since a selection can happen without this being
-- populated (e.g. a future caller of recordIntentSelection that doesn't
-- have a submission id in scope), but every call site added in Part 2
-- populates it, so the funnel's "% of results selected" is a real ratio,
-- not an approximation across two unlinked tables.
alter table public.intent_outcomes add column if not exists submission_id uuid references public.intent_submissions(id) on delete set null;
create index if not exists intent_outcomes_submission_id_idx on public.intent_outcomes(submission_id);

-- Admin-only aggregate funnel, real numbers only, every percentage
-- null-safe against a zero denominator (nullif(...,0)) rather than
-- dividing by zero or defaulting to a fabricated 0%.
create or replace function public.get_intent_funnel_stats()
returns table (
  total_submissions bigint,
  submissions_with_result bigint,
  pct_with_any_result numeric,
  submissions_reaching_business_fallback bigint,
  pct_reaching_business_fallback numeric,
  results_selected bigint,
  pct_results_selected numeric,
  outcomes_answered bigint,
  outcomes_positive bigint,
  pct_positive_outcome numeric,
  repeat_submitters bigint,
  distinct_submitters bigint,
  pct_repeat_submitters numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view funnel stats';
  end if;

  return query
  with repeat_calc as (
    select s1.user_id
    from intent_submissions s1
    join intent_submissions s2
      on s1.user_id = s2.user_id
     and s1.category is not distinct from s2.category
     and s1.id <> s2.id
     and s2.created_at > s1.created_at
     and s2.created_at <= s1.created_at + interval '30 days'
    group by s1.user_id
  )
  select
    (select count(*) from intent_submissions),
    (select count(*) from intent_submissions where had_any_result),
    round(100.0 * (select count(*) from intent_submissions where had_any_result) / nullif((select count(*) from intent_submissions), 0), 1),
    (select count(*) from intent_submissions where reached_business_fallback),
    round(100.0 * (select count(*) from intent_submissions where reached_business_fallback) / nullif((select count(*) from intent_submissions), 0), 1),
    (select count(*) from intent_outcomes where submission_id is not null),
    round(100.0 * (select count(*) from intent_outcomes where submission_id is not null) / nullif((select count(*) from intent_submissions where had_any_result), 0), 1),
    (select count(*) from intent_outcomes where answered_at is not null),
    (select count(*) from intent_outcomes where outcome in ('great', 'okay')),
    round(100.0 * (select count(*) from intent_outcomes where outcome in ('great', 'okay')) / nullif((select count(*) from intent_outcomes where answered_at is not null), 0), 1),
    (select count(distinct user_id) from repeat_calc),
    (select count(distinct user_id) from intent_submissions),
    round(100.0 * (select count(distinct user_id) from repeat_calc) / nullif((select count(distinct user_id) from intent_submissions), 0), 1);
end;
$$;

revoke all on function public.get_intent_funnel_stats() from public, anon;
grant execute on function public.get_intent_funnel_stats() to authenticated;
