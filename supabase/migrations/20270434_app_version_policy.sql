-- Minimum supported app version (owner, 2026-11-27: release infrastructure, the one approved exception to the feature
-- freeze; STAGED, never production without its own approval; mandatory enforcement OFF everywhere it is installed).
--
-- What it does
--   * private.app_version_policy: one row per platform (ios, android, web) in THIS project's database, so staging and
--     production can never share a setting. min_supported_build (below it = update required, only while `enforced`),
--     latest_build (below it = optional, dismissible update), update_url (TestFlight now, the App Store / Google Play
--     later; set by the owner, never guessed by the app). No client grant: changed only by the owner-run script
--     scripts/release/app-version-policy.js (service role), every change appended to private.app_version_policy_log.
--   * private.app_build_availability: which build is actually available to people on each platform (TestFlight group,
--     internal staging distribution, App Store, Google Play). A trigger refuses ENFORCING a minimum above the newest build
--     recorded as available there: a mandatory update can never point people at a build they can't get. Lowering the
--     minimum or switching enforcement off is always allowed (emergency recovery, takes effect on the next request).
--   * public.get_app_version_policy(platform): readable signed out (an app needs it before sign-in). Returns the minimum
--     only while it is enforced.
--   * Server-side enforcement in the existing PostgREST pre-request hook (20270426/0427): the current hook moves to
--     private._business_pre_request() UNCHANGED, and public.nearby_pre_request() now runs the version check first, then
--     it. A request from a build below an ENFORCED minimum is refused before anything runs (P0001, hint
--     'app_update_required'), reads and writes alike, signed in or out; get_app_version_policy itself always passes.
--   * Which build sent the request: the x-nearby-build + x-nearby-platform headers (builds from 88 on), else the native
--     user agent "Nearby/<build>" that every iOS build already sends (builds <= 87 have no update screen, but ARE refused by
--     the server once enforced, so an old install that comes back can't reach an incompatible database). Anything else
--     (browsers without the header, scripts, edge functions' service-role calls, Android builds before this mechanism) is
--     unidentified and passes.
--   * This is a compatibility guard, NOT a security boundary: a client can claim any build. The header can only REFUSE a
--     request, never grant anything; permissions stay with RLS and the server functions, exactly as before.
--   * Fail open: if the version check itself can't complete (bad config row, unreadable headers), the request passes, so
--     a fault here never locks out supported users. The business-location check keeps its own fail-closed rule.
--   * Not covered (documented): Auth (sign-in still works, every REST call after it is refused), Storage, Realtime and
--     edge functions (they don't pass through the PostgREST hook).
-- Additive: no existing row, policy or function body changes. Builds <= 88 work unchanged with enforcement off.

do $$
declare v_current text;
begin
  select split_part(c, '=', 2) into v_current
  from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
  where r.rolname = 'authenticator' and s.setdatabase = 0 and c like 'pgrst.db_pre_request=%';
  if v_current is not null and v_current <> 'public.nearby_pre_request' then
    raise exception 'authenticator has pgrst.db_pre_request = %; expected public.nearby_pre_request', v_current
      using hint = 'pre_request_in_use';
  end if;
  if to_regprocedure('public.nearby_pre_request()') is null then
    raise exception 'public.nearby_pre_request() is missing: apply 20270426 + 20270427 first' using hint = 'pre_request_missing';
  end if;
end $$;

create table private.app_version_policy (
  platform text primary key check (platform in ('ios', 'android', 'web')),
  min_supported_build integer check (min_supported_build between 1 and 999999),
  latest_build integer check (latest_build between 1 and 999999),
  update_url text check (update_url is null or (length(update_url) <= 500 and update_url ~ '^(https://|itms-beta://|itms-apps://|market://)[^[:space:]]{3,}$')),
  enforced boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration 20270434',
  reason text,
  constraint enforced_needs_minimum check (not enforced or min_supported_build is not null),
  constraint latest_not_below_minimum check (latest_build is null or min_supported_build is null or latest_build >= min_supported_build)
);
insert into private.app_version_policy (platform) values ('ios'), ('android'), ('web');

create table private.app_build_availability (
  platform text not null check (platform in ('ios', 'android', 'web')),
  build integer not null check (build between 1 and 999999),
  channel text not null check (channel in ('testflight', 'staging_internal', 'app_store', 'google_play', 'website')),
  available_at timestamptz not null default now(),
  recorded_by text not null,
  evidence text not null check (length(evidence) between 3 and 500),
  primary key (platform, build, channel)
);

create table private.app_version_policy_log (
  id bigserial primary key,
  platform text not null,
  old_row jsonb,
  new_row jsonb not null,
  changed_at timestamptz not null default now()
);
revoke all on private.app_version_policy, private.app_build_availability, private.app_version_policy_log
  from public, anon, authenticated;

create or replace function private._app_version_policy_guard()
returns trigger
language plpgsql
set search_path = private, public, pg_temp
as $$
declare
  v_newest integer;
  v_store text;
  v_target integer;
  v_stricter boolean;
begin
  -- Only a change that makes things stricter or changes the link is checked: lowering, clearing and switching off always
  -- go through (emergency recovery can never be blocked by these checks).
  v_stricter := tg_op = 'INSERT' or new.update_url is distinct from old.update_url
    or (new.enforced and not old.enforced)
    or (new.enforced and new.min_supported_build > coalesce(old.min_supported_build, 0))
    or (new.latest_build > coalesce(old.latest_build, 0));
  select max(build) into v_newest from private.app_build_availability where platform = new.platform;
  -- Raising (or enforcing) a minimum needs that build to be available on this platform. Lowering / switching off: always.
  if new.enforced and (tg_op = 'INSERT' or not old.enforced or new.min_supported_build > coalesce(old.min_supported_build, 0)) then
    if v_newest is null or new.min_supported_build > v_newest then
      raise exception 'Build % is not recorded as available on % (newest available: %); a mandatory update would point people at a build they cannot get',
        new.min_supported_build, new.platform, coalesce(v_newest::text, 'none') using hint = 'build_not_available';
    end if;
  end if;
  -- Raising the optional "a newer version is available" build needs it to be available too (never announce a build
  -- nobody can install). Lowering or clearing it: always.
  if new.latest_build is not null and (tg_op = 'INSERT' or new.latest_build > coalesce(old.latest_build, 0)) then
    if v_newest is null or new.latest_build > v_newest then
      raise exception 'Build % is not recorded as available on % (newest available: %)', new.latest_build, new.platform,
        coalesce(v_newest::text, 'none') using hint = 'build_not_available';
    end if;
  end if;
  -- A public store link only once that store really has the build people are sent for (testers on TestFlight are never
  -- pointed at an App Store / Google Play listing that doesn't carry it yet).
  v_store := case
    when new.update_url ~* '^(itms-apps://|https://apps\.apple\.com/)' then 'app_store'
    when new.update_url ~* '^(market://|https://play\.google\.com/)' then 'google_play'
    when new.update_url ~* '^(itms-beta://|https://testflight\.apple\.com/)' then 'testflight' end;
  v_target := coalesce(case when new.enforced then new.min_supported_build end, new.latest_build);
  if v_stricter and v_store is not null and v_target is not null and not exists (
      select 1 from private.app_build_availability a
      where a.platform = new.platform and a.channel = v_store and a.build >= v_target) then
    raise exception 'The update link goes to % but build % is not recorded as available there', v_store, v_target
      using hint = 'link_channel_unavailable';
  end if;
  new.updated_at := now();
  insert into private.app_version_policy_log (platform, old_row, new_row)
    values (new.platform, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;
revoke all on function private._app_version_policy_guard() from public, anon, authenticated;
create trigger app_version_policy_guard before insert or update on private.app_version_policy
  for each row execute function private._app_version_policy_guard();

-- Public read: what the app needs to decide its own state. Signed-out callers included (before sign-in).
create or replace function public.get_app_version_policy(platform_param text)
returns jsonb
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select jsonb_build_object(
    'platform', p.platform,
    'min_supported_build', case when p.enforced then p.min_supported_build end,
    'latest_build', p.latest_build,
    'update_url', p.update_url)
  from private.app_version_policy p where p.platform = platform_param;
$$;
revoke all on function public.get_app_version_policy(text) from public;
grant execute on function public.get_app_version_policy(text) to anon, authenticated, service_role;

-- The build that sent this PostgREST request, or no row when it can't be identified.
create or replace function private._request_client_build(p_headers json)
returns table (platform text, build integer)
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_build text := btrim(coalesce(p_headers ->> 'x-nearby-build', ''));
  v_platform text := lower(btrim(coalesce(p_headers ->> 'x-nearby-platform', '')));
  v_ua text := coalesce(p_headers ->> 'user-agent', '');
  v_m text;
begin
  if v_build ~ '^[0-9]{1,6}$' and v_platform in ('ios', 'android', 'web') then
    platform := v_platform; build := v_build::integer; return next; return;
  end if;
  -- Builds <= 87 send no header; their native iOS networking sends "Nearby/<build> CFNetwork/... Darwin/...".
  v_m := substring(v_ua from '^Nearby/([0-9]{1,6})(\s|$)');
  if v_m is not null and v_ua ~ '(CFNetwork|Darwin)/' then
    platform := 'ios'; build := v_m::integer; return next;
  end if;
end;
$$;
revoke all on function private._request_client_build(json) from public, anon, authenticated;

create or replace function private._app_version_gate()
returns void
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_refuse boolean := false;
  v_client record;
  v_min integer;
begin
  if coalesce(current_setting('request.path', true), '') = '/rpc/get_app_version_policy' then
    return;
  end if;
  begin
    select * into v_client from private._request_client_build(nullif(current_setting('request.headers', true), '')::json);
    if v_client.build is not null then
      select min_supported_build into v_min from private.app_version_policy
        where platform = v_client.platform and enforced;
      v_refuse := v_min is not null and v_client.build < v_min;
    end if;
  exception when others then
    v_refuse := false; -- fail open: a fault in the version check never locks anyone out
  end;
  if v_refuse then
    raise exception 'A newer version of Nearby is required. Please update the app.'
      using errcode = 'P0001', hint = 'app_update_required';
  end if;
end;
$$;
revoke all on function private._app_version_gate() from public, anon, authenticated;

-- Keep the business-location check exactly as 20270427 left it, under a private name, and chain it.
alter function public.nearby_pre_request() set schema private;
alter function private.nearby_pre_request() rename to _business_pre_request;
revoke all on function private._business_pre_request() from public, anon, authenticated;

create or replace function public.nearby_pre_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private._app_version_gate();
  perform private._business_pre_request();
end;
$$;
revoke all on function public.nearby_pre_request() from public;
grant execute on function public.nearby_pre_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.nearby_pre_request';
notify pgrst, 'reload config';
