-- Owner decision 2026-10-22 (non-partner places, "make Nearby useful first"): every Google Places API call the app makes
-- (Discover Places, topic places, Places to go, the "Also nearby (not a Nearby partner)" row, Create's venue suggestions,
-- the business sign-up lookup) first claims one slot of ONE app-wide daily budget, so Google usage can never pass the
-- owner's limit no matter how many phones search. Initial limit: 100 calls per day (owner).
--   - The day is Google's billing day (America/Los_Angeles), so the count lines up with the Cloud Console.
--   - A refused claim makes no Google call (the client shows no places, never a guess) and is counted in `refused`, so the
--     owner can see when the limit is too tight.
--   - also_nearby_enabled is OFF until the owner has confirmed Google's current terms and billing for that row; the other
--     Places surfaces already existed and keep working under the budget.
--   - Neither table has a client grant; the owner changes the limit or the switch with SQL (service role).
-- Not a billing cap: Google bills what it serves. Budget alerts / quotas in Google Cloud are set separately (owner).

create table if not exists public.places_search_budget (
  id int primary key default 1 check (id = 1),
  daily_limit int not null default 100 check (daily_limit >= 0),
  also_nearby_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.places_search_budget (id) values (1) on conflict (id) do nothing;

create table if not exists public.places_search_usage (
  day date primary key,
  calls int not null default 0,
  refused int not null default 0
);

alter table public.places_search_budget enable row level security;
alter table public.places_search_usage enable row level security;
revoke all on public.places_search_budget from public, anon, authenticated;
revoke all on public.places_search_usage from public, anon, authenticated;

-- One slot per Google call. true = make the call; false = don't (signed out, limit reached, or limit 0).
create or replace function public.claim_places_search(kind_param text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_limit int;
  v_calls int;
begin
  if auth.uid() is null then return false; end if;
  if kind_param is null or kind_param not in ('nearby', 'text', 'details') then
    raise exception 'Unknown places call' using errcode = '22023';
  end if;
  select daily_limit into v_limit from places_search_budget where id = 1;
  if coalesce(v_limit, 0) > 0 then
    insert into places_search_usage as u (day, calls) values (v_day, 1)
      on conflict (day) do update set calls = u.calls + 1 where u.calls < v_limit
      returning calls into v_calls;
  end if;
  if v_calls is null then
    insert into places_search_usage as u (day, refused) values (v_day, 1)
      on conflict (day) do update set refused = u.refused + 1;
    return false;
  end if;
  return true;
end;
$function$;

revoke all on function public.claim_places_search(text) from public, anon;
grant execute on function public.claim_places_search(text) to authenticated;

-- Whether the "Also nearby (not a Nearby partner)" row may show at all (owner switch, default off).
create or replace function public.places_also_nearby_enabled()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null and coalesce((select also_nearby_enabled from places_search_budget where id = 1), false);
$function$;

revoke all on function public.places_also_nearby_enabled() from public, anon;
grant execute on function public.places_also_nearby_enabled() to authenticated;
