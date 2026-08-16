-- Scorecard-to-10 initiative, Phase 1 item 1 (see CLAUDE.md): fixes for
-- PRODUCT_AUDIT/SECDEF_AUDIT_BATCH2.md's real findings. All function bodies
-- pulled fresh from live production via pg_get_functiondef before editing.

-- Finding 1 (HIGH) -- increment_browse_views(user_id_param, ...) had zero
-- ownership check: any authenticated user could pass an arbitrary victim's
-- id to burn their daily Browse allowance to the cap. The exact
-- check_and_increment_ai_use bug shape, unfixed here until now. Guard
-- placed before the row lock, same as that fix's own placement.
create or replace function public.increment_browse_views(user_id_param uuid, count_param integer, daily_limit integer)
returns table(allowed boolean, current_count integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
begin
  if auth.uid() is distinct from user_id_param then
    return query select false, 0;
    return;
  end if;

  select browse_views_today, browse_views_date, coalesce(timezone, 'UTC') into v_current_count, v_current_date, v_timezone
  from profiles where id = user_id_param for update;
  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;
  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;
  if v_current_count >= daily_limit then
    return query select false, v_current_count;
    return;
  end if;
  v_current_count := v_current_count + count_param;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set browse_views_today = v_current_count, browse_views_date = v_today_in_user_tz
  where id = user_id_param;
  return query select true, v_current_count;
end;
$$;

-- Finding 2 (MEDIUM) -- get_sighting_fuzzed_coords(sighting_ids) bypassed
-- sightings' own real RLS (auth.uid() = user_a/user_b, not is_blocked)
-- with zero ownership check of its own. Confirmed no client caller exists
-- anywhere in src/ today (proximity.js reads sightings directly through
-- the correctly-scoped RLS path instead) -- real defense-in-depth hygiene,
-- not a currently-reachable exploit, same posture as the
-- business_partner_requests anon-grant close earlier this month.
create or replace function public.get_sighting_fuzzed_coords(sighting_ids uuid[])
returns table(id uuid, fuzzed_lat double precision, fuzzed_lng double precision)
language sql
stable security definer
set search_path to 'public'
as $$
  select
    s.id,
    split_part(s.approx_area, ',', 1)::double precision + (((('x' || substr(md5(s.id::text || 'lat'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lat,
    split_part(s.approx_area, ',', 2)::double precision + (((('x' || substr(md5(s.id::text || 'lng'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007) as fuzzed_lng
  from sightings s
  where s.id = any(sighting_ids)
  and (s.user_a = auth.uid() or s.user_b = auth.uid())
  and s.approx_area is not null;
$$;

-- Finding 3 (LOW-MEDIUM) -- has_mutual_notice(from_id, to_id) has the
-- identical no-ownership-check shape, bypassing notices' RLS to answer
-- whether any two arbitrary users have a mutual notice. Confirmed zero
-- client callers anywhere in src/ (grepped alongside its likely successor
-- check_mutual_notice, which is also uncalled) -- kept rather than dropped,
-- since a dead-but-harmless function isn't worth a migration of its own to
-- remove, but guarded the same way in case something calls it later.
create or replace function public.has_mutual_notice(from_id uuid, to_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select case
    when auth.uid() in (from_id, to_id) then exists (
      select 1 from notices where from_user = to_id and to_user = from_id
    )
    else false
  end;
$$;

-- Finding 4 (LOW) -- get_weather_result(request_id_param) trusted an
-- unscoped shared id space (net._http_response, shared by every async job
-- in the app, not just weather requests) with no check that the caller was
-- the one who actually submitted that request. Low real severity (the
-- returned fields never echo back lat/lng, so a cross-user hit only leaks
-- another user's local weather condition, itself near-public information)
-- but a real gap, closed properly with a mapping table rather than a
-- five-minute guard, since there was genuinely nothing to check the
-- request id against before this.
create table if not exists public.weather_requests (
  request_id bigint primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.weather_requests enable row level security;
-- No client-facing policy needed -- both reads/writes only ever happen
-- inside the two SECURITY DEFINER functions below, matching this schema's
-- established "no direct client access, RPC-mediated" convention for a
-- table with no legitimate direct-client read/write shape.
revoke all on public.weather_requests from authenticated, anon;
create index if not exists weather_requests_user_id_idx on public.weather_requests(user_id);

create or replace function public.submit_weather_request(my_lat double precision, my_lng double precision)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  api_key text;
  request_id bigint;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'openweather_api_key';

  select net.http_get(
    url := format(
      'https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial',
      my_lat, my_lng, api_key
    )
  ) into request_id;

  insert into weather_requests (request_id, user_id) values (request_id, auth.uid());

  return request_id;
end;
$$;

create or replace function public.get_weather_result(request_id_param bigint)
returns table(condition text, temp_f numeric, forecast_label text, forecast_detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  response_content text;
  response jsonb;
  weather_main text;
  weather_temp numeric;
  weather_condition_id integer;
begin
  if not exists (
    select 1 from weather_requests
    where request_id = request_id_param and user_id = auth.uid()
  ) then
    return;
  end if;

  select content into response_content from net._http_response where id = request_id_param;

  if response_content is null then
    return;
  end if;

  response := response_content::jsonb;
  weather_main := response -> 'weather' -> 0 ->> 'main';
  weather_temp := (response -> 'main' ->> 'temp')::numeric;
  weather_condition_id := (response -> 'weather' -> 0 ->> 'id')::integer;

  return query select
    weather_main,
    weather_temp,
    case
      when weather_condition_id < 700 then 'Quiet'
      when weather_temp < 45 or weather_temp > 95 then 'Quiet'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Excellent'
      else 'Good'
    end,
    case
      when weather_condition_id < 700 then 'Rain or storms expected — a better time for something indoors.'
      when weather_temp < 45 then 'Cold out — outdoor plans might be a harder sell right now.'
      when weather_temp > 95 then 'Very hot — outdoor plans are better earlier or later in the day.'
      when weather_main = 'Clear' and weather_temp between 60 and 85 then 'Clear skies and comfortable temps — good conditions for outdoor plans.'
      else 'Decent conditions out there right now.'
    end;
end;
$$;

-- Finding 5 (LOW, hygiene) -- 9 cron-only functions (0 client-supplied
-- target id, meant to run only via their own pg_cron job) still carried
-- authenticated's default EXECUTE grant. Every one of these is invoked
-- directly by pg_cron AS the `postgres` role (confirmed live via
-- cron.job.username), which owns every one of these functions -- object
-- owners always retain full privileges on their own objects independent of
-- any grant/revoke to another role, so this is safe unlike the
-- check_is_admin nested-call case earlier in this same pass (a materially
-- different situation: that was a revoked grant breaking a *nested* call
-- from *within* another SECURITY DEFINER function, not a top-level
-- direct-as-owner cron invocation). Matches the existing
-- _business_request_fanout-style internal-helper lockdown convention
-- already used elsewhere in this schema; 3 of the 12 real cron functions
-- (expire_stale_business_requests, generate_monthly_invoices,
-- send_momentum_nudges) were already correctly locked down in an earlier
-- session.
revoke execute on function public.delete_expired_disappearing_messages() from authenticated, anon;
revoke execute on function public.delete_expired_stories() from authenticated, anon;
revoke execute on function public.expire_live_tracking_sessions() from authenticated, anon;
revoke execute on function public.generate_next_recurring_gathering() from authenticated, anon;
revoke execute on function public.purge_expired_sightings() from authenticated, anon;
revoke execute on function public.send_birthday_reminders() from authenticated, anon;
revoke execute on function public.send_first_mission_reminders() from authenticated, anon;
revoke execute on function public.send_gathering_reminders() from authenticated, anon;
revoke execute on function public.send_match_reminders() from authenticated, anon;
