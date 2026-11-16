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
--   * Exempt: select_managed_business and get_my_businesses (switching / listing must work from a stale screen, so it
--     can recover), signed-out requests, and requests without the header.
--   * Without the header nothing changes: builds <= 87, the current website, the service role, edge functions' own
--     service-role calls. Known limit (owner decision pending): a build <= 87 on an account that holds SEVERAL locations
--     still has the old window (it can't say which location it shows). See the fixes doc for the option to refuse such
--     requests outright.
--   * Edge functions that act for a location already take the client's partnerId and refuse when it differs from the
--     selection; from this branch they also forward it as this header to their user-scoped calls (no check-then-write
--     gap), and Stripe Connect onboarding takes it too.
--   * An unexpected internal error in the check returns without refusing (never takes the whole API down); a confirmed
--     mismatch, a malformed header, or a lock that times out (the selection row held by a switch) refuses.
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
  v_header text;
  v_me uuid;
  v_selected uuid;
  v_refuse boolean := false;
begin
  begin
    v_header := nullif(btrim(coalesce((nullif(current_setting('request.headers', true), '')::json) ->> 'x-nearby-business', '')), '');
    if v_header is null then return; end if;
    v_me := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub';
    if v_me is null then return; end if;
    if coalesce(current_setting('request.path', true), '') in ('/rpc/select_managed_business', '/rpc/get_my_businesses') then
      return;
    end if;
    if v_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_refuse := true;
    else
      if current_setting('transaction_read_only', true) = 'off' then
        select managed_partner_id into v_selected from public.profiles where id = v_me for share;
      else
        select managed_partner_id into v_selected from public.profiles where id = v_me;
      end if;
      v_refuse := v_selected is distinct from v_header::uuid;
    end if;
  exception
    when lock_not_available then
      v_refuse := true; -- a switch held the row past lock_timeout: refuse rather than guess
    when others then
      return;
  end;
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
