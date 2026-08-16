-- Closes "no impression/dismissal analytics for either new Home nudge card"
-- (V2_ACCEPTANCE_REPORT_2026-08-15.md §10; carried into
-- CONSOLIDATED_AUDIT_2026-08-15.md's still-open list, row 14/item 4). The
-- two cards (the predictive-pattern nudge and the group-intent nudge) were
-- shown/dismissed/acted-on with zero record of any of it -- there was no
-- way to compute how often either is shown vs. dismissed vs. acted on,
-- which is the one number that would actually validate whether either
-- nudge earns its own screen real estate.
--
-- Same shape as intent_submissions/intent_outcomes (20260815_intent_
-- submissions_and_funnel_stats.sql): a plain owner-scoped "for all"
-- RLS policy fully covers "only ever my own rows," no RPC needed for the
-- write side, matching this schema's own established pattern for a
-- personal-record table.

create table if not exists public.home_nudge_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nudge_type text not null,
  event text not null,
  category text,
  created_at timestamptz not null default now(),
  constraint home_nudge_events_nudge_type_check check (nudge_type in ('predictive', 'group_intent')),
  constraint home_nudge_events_event_check check (event in ('shown', 'dismissed', 'acted'))
);

alter table public.home_nudge_events enable row level security;

create policy "Users manage their own nudge events"
  on public.home_nudge_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists home_nudge_events_user_id_idx on public.home_nudge_events(user_id);
create index if not exists home_nudge_events_type_event_idx on public.home_nudge_events(nudge_type, event);
revoke all on public.home_nudge_events from anon;

-- Admin-only rollup, same check_is_admin() gate as get_intent_funnel_stats()/
-- get_marketplace_reliability_rankings()/get_cross_user_intent_patterns() --
-- every percentage nullif(...,0)-guarded against a zero denominator, never
-- defaulted to a fabricated value.
create or replace function public.get_home_nudge_stats()
returns table (
  nudge_type text,
  shown_count bigint,
  dismissed_count bigint,
  acted_count bigint,
  pct_dismissed numeric,
  pct_acted numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view nudge stats';
  end if;

  return query
  select
    t.nudge_type,
    coalesce((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'shown'), 0)::bigint,
    coalesce((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'dismissed'), 0)::bigint,
    coalesce((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'acted'), 0)::bigint,
    round(100.0 * coalesce((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'dismissed'), 0)
      / nullif((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'shown'), 0), 1),
    round(100.0 * coalesce((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'acted'), 0)
      / nullif((select count(*) from home_nudge_events e where e.nudge_type = t.nudge_type and e.event = 'shown'), 0), 1)
  from (values ('predictive'), ('group_intent')) as t(nudge_type);
end;
$$;

revoke all on function public.get_home_nudge_stats() from public, anon;
grant execute on function public.get_home_nudge_stats() to authenticated;
