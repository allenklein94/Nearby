-- Behavioral recommendation signal: what a user actually opens / creates / joins. Private by design:
--   * owner-only (RLS: select + delete own rows; inserts only through record_behavior_event, which validates and dedupes),
--   * never readable by another user or a business, never joined into anything user-facing,
--   * 90-day window (older own rows are purged on write, and reads ignore them),
--   * deletable at any time (clear_my_behavior_history) and removed with the account (FK cascade).
-- It only ever ADDS a ranking nudge (dampened for new accounts, see signalSourceMaturity.js); it never hides anything.

create table if not exists public.behavior_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('open', 'create', 'join')),
  entity_type text not null check (entity_type in ('gathering', 'community', 'business_request')),
  entity_id uuid not null,
  category text not null,
  created_at timestamptz not null default now()
);
create index if not exists behavior_events_user_idx on public.behavior_events(user_id, created_at desc);
alter table public.behavior_events enable row level security;
revoke all on public.behavior_events from public, anon, authenticated;
grant select, delete on public.behavior_events to authenticated;
drop policy if exists "Users read own behavior" on public.behavior_events;
create policy "Users read own behavior" on public.behavior_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users delete own behavior" on public.behavior_events;
create policy "Users delete own behavior" on public.behavior_events for delete to authenticated using (user_id = auth.uid());

create or replace function public.record_behavior_event(event_type_param text, entity_type_param text, entity_id_param uuid, category_param text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or category_param is null or length(category_param) = 0 or length(category_param) > 60 then return; end if;
  if event_type_param not in ('open', 'create', 'join') or entity_type_param not in ('gathering', 'community', 'business_request') then
    raise exception 'Invalid behavior event.';
  end if;
  -- One event per user+type+entity per hour: re-opening the same screen is not a stronger preference.
  if exists (select 1 from behavior_events where user_id = auth.uid() and event_type = event_type_param
             and entity_id = entity_id_param and created_at > now() - interval '1 hour') then
    return;
  end if;
  delete from behavior_events where user_id = auth.uid() and created_at < now() - interval '90 days';
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category)
  values (auth.uid(), event_type_param, entity_type_param, entity_id_param, category_param);
end;
$function$;
revoke all on function public.record_behavior_event(text, text, uuid, text) from public, anon;

-- Per-category behavioral weight over the window. create/join are deliberate acts (3), an open is a glance (1), and each
-- category's total is capped so one binge of opens can never drown out what the user told us.
create or replace function public.get_my_behavior_categories(days_back_param integer default 90)
returns table(category text, weight integer)
language sql security definer stable set search_path to 'public' as $function$
  select be.category,
         least(12, sum(case be.event_type when 'open' then 1 else 3 end))::integer
  from behavior_events be
  where be.user_id = auth.uid() and be.created_at >= now() - make_interval(days => least(coalesce(days_back_param, 90), 90))
  group by be.category
  order by 2 desc;
$function$;
revoke all on function public.get_my_behavior_categories(integer) from public, anon;

create or replace function public.clear_my_behavior_history()
returns void language sql security definer set search_path to 'public' as $function$
  delete from behavior_events where user_id = auth.uid();
$function$;
revoke all on function public.clear_my_behavior_history() from public, anon;
