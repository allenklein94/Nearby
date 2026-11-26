-- Stale-location guard (owner, 2026-11-16; STAGED on post-tier1/multi-location, after 20270424; never production without
-- its own approval).
--
-- Problem (20270424's known limit): the selected location is per ACCOUNT (profiles.managed_partner_id). If the phone shows
-- Location A and the website switches the account to Location B, an already-open form on the phone still saves through
-- the 115 functions / 27 policies that act for the location selected NOW, so the write lands on B. Re-reading the
-- selection on focus / foreground (the app's earlier safeguard) narrowed the window but could not close it.
--
-- Fix, in ONE place, with no function or policy rewritten: a PostgREST pre-request check.
--   * A client that knows which location its screen shows sends it with every REST request as the header
--     x-nearby-business (the app + website from this branch, while Business Mode has a location loaded).
--   * Before PostgREST runs the request (any table write, any RPC, any read), public.nearby_pre_request() compares that
--     header with the account's selection. Different (or a malformed value, or no location selected any more) = the
--     whole request is refused, nothing runs: P0001, hint 'business_selection_changed'. The app then reloads Business
--     Mode for the location the server has selected. A stale screen therefore can never write to, or read, the other
--     location; it can't even reach its own old location until it reloads (fails closed).
--   * On a write the selection is read FOR SHARE, so a switch from another device can't commit between the check and
--     the request's own read of the column (it waits until the write commits; the next stale request is then refused).
--     A GET runs read-only (no lock possible); a read can't change data.
--   * The header can only REFUSE, never grant: a match adds nothing beyond the existing checks (membership,
--     suspension, the request belonging to the business). It is never trusted for authorization.
--   * Exempt: select_managed_business, get_my_businesses and note_location_aware_session (switching / listing / recording
--     must work from a stale screen, so it can recover; checked first, before anything that can fail), signed-out
--     requests, and requests without the header. Signing out is the Auth API, never PostgREST: never affected.
--   * Without the header nothing changes: builds <= 87, the current website, the service role, edge functions' own
--     service-role calls. A client without the header can't say which location it shows, so (owner, 2026-11-16, option a,
--     server-enforced below) an account gets a SECOND location only while every one of its live sign-in sessions has
--     recorded that it runs a location-aware client (note_location_aware_session, called by Business Mode from this
--     branch). Single-location accounts are never touched by the gate.
--   * Edge functions that act for a location already take the client's partnerId and refuse when it differs from the
--     selection; from this branch they also forward it as this header to their user-scoped calls (no check-then-write
--     gap), and Stripe Connect onboarding takes it too.
--   * Fail closed for writes (owner, 2026-11-16): a client that named a location and a check that cannot complete (lock
--     timeout, any unexpected error) = a write is refused, a read passes (it changes nothing). Requests without the header
--     never reach that branch, so an internal fault can't take the API down for builds <= 87 or single-location use.
-- Refuses to install over another pre-request hook (none exists in production today; checked at deploy).

do $$
declare v_current text;
begin
  select split_part(c, '=', 2) into v_current
  from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
  where r.rolname = 'authenticator' and s.setdatabase = 0 and c like 'pgrst.db_pre_request=%';
  if v_current is not null and v_current <> 'public.nearby_pre_request' then
    raise exception 'authenticator already has pgrst.db_pre_request = %; combine it with the business selection check first', v_current
      using hint = 'pre_request_in_use';
  end if;
end $$;

create or replace function public.nearby_pre_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text := coalesce(current_setting('request.path', true), '');
  v_read_only boolean := coalesce(current_setting('transaction_read_only', true), 'off') = 'on';
  v_header text;
  v_me uuid;
  v_selected uuid;
  v_refuse boolean := false;
begin
  -- Recovery paths first, before anything that could fail: switching, listing, and recording this session.
  if v_path in ('/rpc/select_managed_business', '/rpc/get_my_businesses', '/rpc/note_location_aware_session') then
    return;
  end if;
  begin
    v_header := nullif(btrim(coalesce((nullif(current_setting('request.headers', true), '')::json) ->> 'x-nearby-business', '')), '');
  exception when others then
    -- headers unreadable: can't tell whether this client named a location. A write is refused (fail closed); a read
    -- changes nothing and passes. Requests from builds that never send the header are refused only if this happens on
    -- a write, which PostgREST never produces (it always sets valid JSON).
    v_refuse := not v_read_only;
  end;
  if v_header is not null then
    begin
      v_me := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub';
      if v_me is not null then
        if v_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          v_refuse := true;
        elsif not v_read_only then
          select managed_partner_id into v_selected from public.profiles where id = v_me for share;
          v_refuse := v_selected is distinct from v_header::uuid;
        else
          select managed_partner_id into v_selected from public.profiles where id = v_me;
          v_refuse := v_selected is distinct from v_header::uuid;
        end if;
      end if;
    exception when others then
      -- a client that named a location, and the check could not complete (lock timeout, anything unexpected): a write
      -- is refused (fail closed: never a possibly wrong-location change); a read passes (it changes nothing).
      v_refuse := not v_read_only;
    end;
  end if;
  if v_refuse then
    raise exception 'This screen is for another of your locations. Reload Business Mode.'
      using errcode = 'P0001', hint = 'business_selection_changed';
  end if;
end;
$$;

revoke all on function public.nearby_pre_request() from public;
grant execute on function public.nearby_pre_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.nearby_pre_request';
notify pgrst, 'reload config';

-- ===== Rollout gate (owner option a, server-enforced): no second location while an old client is signed in =====
-- One row per sign-in session whose client is location-aware (sends x-nearby-business). Written only by the session
-- itself (note_location_aware_session reads the session id from its own JWT); no client grant on the table.
create table private.location_aware_sessions (
  user_id uuid not null,
  session_id uuid not null,
  noted_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

create or replace function public.note_location_aware_session()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_session uuid;
begin
  if v_me is null then return; end if;
  begin
    v_session := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'session_id';
  exception when others then
    return;
  end;
  if v_session is null then return; end if;
  insert into private.location_aware_sessions (user_id, session_id) values (v_me, v_session) on conflict do nothing;
end;
$$;
revoke all on function public.note_location_aware_session() from public, anon;
grant execute on function public.note_location_aware_session() to authenticated;

-- Ready = at least one live session, and every live session recorded itself. "Live" = not past its not_after when the
-- Auth schema has that column (hosted); a signed-out session is deleted by Auth, so it no longer counts.
create or replace function private.multi_location_ready(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select s.id from auth.sessions s
    where s.user_id = uid
      and coalesce(nullif(to_jsonb(s) ->> 'not_after', '')::timestamptz, 'infinity'::timestamptz) > now()
  )
  select exists (select 1 from live)
     and not exists (select 1 from live l where not exists (
           select 1 from private.location_aware_sessions a where a.user_id = uid and a.session_id = l.id));
$$;
revoke all on function private.multi_location_ready(uuid) from public, anon, authenticated;

-- Every path that adds a membership (approval, web claim, service role, the 0424 trigger) passes here. The first
-- membership is never gated (every single-location account, and every new business owner).
create or replace function private._gate_second_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_old int;
begin
  -- re-recording a membership the account already has (a switch back) is never gated
  if exists (select 1 from private.business_memberships m where m.user_id = new.user_id and m.partner_id = new.partner_id) then
    return new;
  end if;
  select count(*) into v_old from private.business_memberships m
  where m.user_id = new.user_id and m.partner_id <> new.partner_id;
  if v_old > 0 and not private.multi_location_ready(new.user_id) then
    raise exception 'This account is signed in on a device or website version that can''t manage several locations. Update the app and the website session, then try again.'
      using errcode = 'P0001', hint = 'multi_location_not_ready';
  end if;
  return new;
end;
$$;
revoke all on function private._gate_second_location() from public, anon, authenticated;
create trigger gate_second_location
  before insert on private.business_memberships
  for each row execute function private._gate_second_location();
