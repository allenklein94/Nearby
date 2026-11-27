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
--   * Strict mode (private.app_version_settings.refuse_unidentified, default OFF, its own owner step): while on, a
--     request whose build can't be identified (no header and no Nearby user agent, or a malformed header with no usable
--     user agent) is refused like a too-old build. Server-side callers (service_role: edge functions' own service calls,
--     scripts, cron) and the policy read always pass. Off = unidentified clients pass, as before.
--   * public.app_version_ok(): a probe edge functions call with the client's forwarded version headers, so the SAME hook
--     decides for edge-function calls (supabase/functions/_shared/appVersion.ts).
--   * This is a compatibility guard, NOT a security boundary: a client can claim any build. The header can only REFUSE a
--     request, never grant anything; permissions stay with RLS and the server functions, exactly as before.
--   * Fail open while strict mode is off: if the version check itself can't complete (bad config row, unreadable
--     headers), the request passes, so a fault here never locks out supported users. With strict mode on, a check that
--     can't complete refuses (the policy read + service role still pass, so `off` always works). The business-location
--     check keeps its own fail-closed rule.
--   * Not covered, by design (documented in RELEASE_COMPATIBILITY_PROCESS): Auth (sign-in, recovery, sign-out keep
--     working; every REST / edge-function call after it is refused), Storage uploads (an old build's upload can't be
--     attached: the REST / moderate-photo call that registers it is refused), Realtime (read-only, RLS-filtered).
--     deploy.js accepts enforcement in place of retiring old builds only for migrations that touch none of those.
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
create table private.app_version_settings (
  id boolean primary key default true check (id),
  refuse_unidentified boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration 20270434',
  reason text
);
insert into private.app_version_settings default values;
revoke all on private.app_version_policy, private.app_build_availability, private.app_version_policy_log,
  private.app_version_settings from public, anon, authenticated;

create or replace function private._app_version_settings_log()
returns trigger
language plpgsql
set search_path = private, public, pg_temp
as $$
begin
  new.updated_at := now();
  insert into private.app_version_policy_log (platform, old_row, new_row)
    values ('*', case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;
revoke all on function private._app_version_settings_log() from public, anon, authenticated;
create trigger app_version_settings_log before update on private.app_version_settings
  for each row execute function private._app_version_settings_log();

-- Which distribution channel an update link sends people to. Any other https link (an internal staging install page)
-- counts as staging_internal; web always reloads from the website.
create or replace function private._update_url_channel(p_platform text, p_url text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
    when p_platform = 'web' then 'website'
    when p_url is null then null
    when p_url ~* '^(itms-apps://|https://apps\.apple\.com/)' then 'app_store'
    when p_url ~* '^(market://|https://play\.google\.com/)' then 'google_play'
    when p_url ~* '^(itms-beta://|https://testflight\.apple\.com/)' then 'testflight'
    when p_url ~* '^https://' then 'staging_internal' end;
$$;
revoke all on function private._update_url_channel(text, text) from public, anon, authenticated;

create or replace function private._app_version_policy_guard()
returns trigger
language plpgsql
set search_path = private, public, pg_temp
as $$
declare
  v_channel text;
  v_raise_min boolean;
  v_raise_latest boolean;
  v_url_changed boolean;
begin
  -- Only a change that makes things stricter or changes the link is checked: lowering, clearing and switching off always
  -- go through (emergency recovery can never be blocked by these checks).
  v_url_changed := tg_op = 'UPDATE' and new.update_url is distinct from old.update_url;
  v_raise_min := new.enforced and (tg_op = 'INSERT' or not old.enforced
    or new.min_supported_build > coalesce(old.min_supported_build, 0) or v_url_changed);
  v_raise_latest := new.latest_build is not null and (tg_op = 'INSERT'
    or new.latest_build > coalesce(old.latest_build, 0) or v_url_changed);
  v_channel := private._update_url_channel(new.platform, new.update_url);
  -- A mandatory update always says where to get the build (the app's Update button), and that place must already carry
  -- it: the build is recorded available on THAT channel (TestFlight testers are never sent to an App Store listing
  -- without it, public users never to a TestFlight link). Web: the website must carry it.
  if v_raise_min then
    if new.platform <> 'web' and new.update_url is null then
      raise exception 'Enforcing a minimum on % needs an update link (where people get build %)', new.platform,
        new.min_supported_build using hint = 'update_url_required';
    end if;
    if not exists (select 1 from private.app_build_availability a
        where a.platform = new.platform and a.channel = v_channel and a.build >= new.min_supported_build) then
      raise exception 'Build % is not recorded as available on % via % (the update link); a mandatory update would point people at a build they cannot get',
        new.min_supported_build, new.platform, v_channel using hint = 'build_not_available';
    end if;
  end if;
  -- The optional "a newer version is available" build: available where the link (or, without a link, anywhere on this
  -- platform) sends people. Lowering or clearing it: always.
  if v_raise_latest and not exists (select 1 from private.app_build_availability a
      where a.platform = new.platform and a.build >= new.latest_build
        and (v_channel is null or a.channel = v_channel)) then
    raise exception 'Build % is not recorded as available on % %', new.latest_build, new.platform,
      case when v_channel is null then '' else ' via ' || v_channel end using hint = 'build_not_available';
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

-- Probe for edge functions: called with the client's forwarded version headers; the pre-request hook above refuses it
-- exactly as it would the client's own REST call. Returns true when it runs.
create or replace function public.app_version_ok()
returns boolean
language sql
stable
set search_path = pg_temp
as $$ select true $$;
revoke all on function public.app_version_ok() from public;
grant execute on function public.app_version_ok() to anon, authenticated, service_role;

-- The build that sent this PostgREST request: (platform, build) when identified, else (null, null, malformed).
-- malformed = a version header was sent but isn't valid (and no Nearby user agent identifies the build either).
create or replace function private._request_client_build(p_headers json)
returns table (platform text, build integer, malformed boolean)
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
    platform := v_platform; build := v_build::integer; malformed := false; return next; return;
  end if;
  -- Builds <= 87 send no header; their native iOS networking sends "Nearby/<build> CFNetwork/... Darwin/...".
  v_m := substring(v_ua from '^Nearby/([0-9]{1,6})(\s|$)');
  if v_m is not null and v_ua ~ '(CFNetwork|Darwin)/' then
    platform := 'ios'; build := v_m::integer; malformed := false; return next; return;
  end if;
  platform := null; build := null;
  malformed := (p_headers ->> 'x-nearby-build') is not null or (p_headers ->> 'x-nearby-platform') is not null;
  return next;
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
  v_strict boolean := false;
  v_client record;
  v_min integer;
begin
  -- Always pass: the policy read (an app must be able to learn it needs an update) and server-side callers.
  if coalesce(current_setting('request.path', true), '') = '/rpc/get_app_version_policy' then
    return;
  end if;
  -- (security definer: current_user is the owner here, so the caller's role comes from the request's JWT claims)
  begin
    if nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role' = 'service_role' then
      return;
    end if;
  exception when others then
    null; -- unreadable claims: not a server-side caller
  end;
  begin
    select s.refuse_unidentified into v_strict from private.app_version_settings s;
    v_strict := coalesce(v_strict, false);
  exception when others then
    v_strict := false; -- the setting can't be read: strict mode can't be assumed
  end;
  begin
    select * into v_client from private._request_client_build(nullif(current_setting('request.headers', true), '')::json);
    if v_client.build is not null then
      select min_supported_build into v_min from private.app_version_policy
        where platform = v_client.platform and enforced;
      v_refuse := v_min is not null and v_client.build < v_min;
    else
      v_refuse := v_strict; -- unidentified or malformed: refused only in strict mode
    end if;
  exception when others then
    v_refuse := v_strict; -- strict off: fail open; strict on: a check that can't complete refuses
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
