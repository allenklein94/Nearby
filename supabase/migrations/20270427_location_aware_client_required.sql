-- Old-build loophole closed (owner, 2026-11-16; STAGED on post-tier1/multi-location, after 20270426; never production
-- without its own approval).
--
-- 20270426's residual: a client that never names a location (builds <= 87, the current website) acts for whichever
-- location the account has selected NOW. Its rollout gate stops a SECOND location being added while such a client is
-- signed in, but an old build that signs in AFTERWARDS isn't stopped: another device switches the account to B, and the
-- old build, still showing A, saves onto B.
--
-- Fix, server-side, no function body or policy rewritten: for an account that holds TWO OR MORE locations
-- (private.business_memberships), a write that acts for "the selected location" must say which location it is for.
--   * The PostgREST pre-request check (public.nearby_pre_request, replaced here) refuses a write WITHOUT x-nearby-business
--     when the account has 2+ locations and the request is location-specific:
--       - an RPC whose body reads the caller's selected location (managed_partner_id / my_managed_partner_id(): the same
--         rule the real-API test enumerates), decided from the catalog at request time, so a function added later is
--         covered without a list to maintain; minus the person-level ones below;
--       - a direct write to a table with a write policy that reads the selected location (brand_offers, business_updates
--         today; same catalog rule), minus stories + business_messages, which customers write too (row triggers below).
--     Refused = P0001, hint 'location_aware_client_required'. Reads (read-only transactions) pass: they change nothing.
--   * Row triggers on the two shared tables refuse only the business-side row: a story posted as a business
--     (partner_id set) and a business reply (from_business): a customer's own story or message is untouched.
--   * A gathering / community created by a 2+-location account is credited to a location only when the request named it
--     (x-nearby-business, already checked equal to the selection by the pre-request check); otherwise it is the person's
--     own (hosting_partner_id null), never silently credited to whichever location happens to be selected.
--   * The header is still never trusted by itself: when present it must equal the account's current selection, which
--     select_managed_business only sets for a location the account is a member of and that is not suspended (20270424);
--     a removed membership clears / changes the selection, so a stale header is refused (20270426).
--   * Unchanged: accounts with 0 or 1 location (every account today), customer-side functions and tables, signed-out
--     requests, the service role (no user), edge functions' service-role writes, recovery (select_managed_business,
--     get_my_businesses, note_location_aware_session: checked first), sign-in / sign-out (Auth API, never PostgREST).
--   * Person-level exceptions (they read managed_partner_id only to check "is this person a business owner", and
--     write the person's own row): set_my_notification_group, set_my_business_email_enabled.
--   * Fail closed: if the check itself can't complete for a signed-in write (catalog / membership lookup error), the write
--     is refused; recovery paths were already let through before anything that can fail.
-- Edge functions: business-stripe-connect-onboarding refuses (409) when no partnerId is sent for a 2+-location account
-- (it used to fall back to the selection); the other location-acting functions already require partnerId and compare it
-- with the selection.

create or replace function private._location_count(uid uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from private.business_memberships where user_id = uid;
$$;
revoke all on function private._location_count(uuid) from public, anon, authenticated;

-- Service-only: the edge functions ask how many locations an account holds (private isn't exposed to PostgREST).
create or replace function public._account_location_count(uid_param uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private._location_count(uid_param);
$$;
revoke all on function public._account_location_count(uuid) from public, anon, authenticated;
grant execute on function public._account_location_count(uuid) to service_role;

-- Does this PostgREST path act for "the selected location"? Catalog rule (see the header).
create or replace function private._location_scoped_path(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_name text;
begin
  if p_path like '/rpc/%' then
    v_name := substr(p_path, 6);
    if v_name in ('select_managed_business', 'get_my_businesses', 'note_location_aware_session', 'nearby_pre_request',
                  'my_managed_partner_id', 'set_my_notification_group', 'set_my_business_email_enabled') then
      return false;
    end if;
    return exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name and p.prokind = 'f'
        and p.prosrc ~ '(managed_partner_id|my_managed_partner_id)');
  end if;
  v_name := split_part(substr(p_path, 2), '/', 1);
  if v_name = '' or v_name in ('stories', 'business_messages') then
    return false;
  end if;
  return exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = v_name and cmd <> 'SELECT'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(managed_partner_id|my_managed_partner_id)');
end;
$$;
revoke all on function private._location_scoped_path(text) from public, anon, authenticated;

-- The location this request named (already checked equal to the selection by the pre-request check), or null.
create or replace function private._request_named_business()
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare v text;
begin
  v := nullif(btrim(coalesce((nullif(current_setting('request.headers', true), '')::json) ->> 'x-nearby-business', '')), '');
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return v::uuid; end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private._request_named_business() from public, anon, authenticated;

-- True when a signed-in user's request names no location and the account holds 2+ locations (an old client).
-- Fails closed (true) for a signed-in request when the lookup itself errors.
create or replace function private._unnamed_multi_location_request()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_me uuid;
begin
  begin
    v_me := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub';
  exception when others then
    return false; -- no readable user: not a signed-in client request
  end;
  if v_me is null then return false; end if;
  begin
    return private._request_named_business() is null and private._location_count(v_me) >= 2;
  exception when others then
    return true;
  end;
end;
$$;
revoke all on function private._unnamed_multi_location_request() from public, anon, authenticated;

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
  v_unnamed boolean := false;
begin
  -- Recovery paths first, before anything that could fail: switching, listing, and recording this session.
  if v_path in ('/rpc/select_managed_business', '/rpc/get_my_businesses', '/rpc/note_location_aware_session') then
    return;
  end if;
  begin
    v_header := nullif(btrim(coalesce((nullif(current_setting('request.headers', true), '')::json) ->> 'x-nearby-business', '')), '');
  exception when others then
    -- headers unreadable: a write is refused (fail closed); a read changes nothing and passes.
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
      v_refuse := not v_read_only;
    end;
  elsif not v_refuse and not v_read_only then
    -- No location named (builds <= 87, the current website): only for a 2+-location account and a location-specific
    -- write. Single-location accounts (every account today) stop at the indexed membership count.
    begin
      v_me := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub';
      if v_me is not null and private._location_count(v_me) >= 2 and private._location_scoped_path(v_path) then
        v_unnamed := true;
      end if;
    exception when others then
      -- a signed-in write whose safety can't be determined: refused (fail closed)
      v_unnamed := v_me is not null;
    end;
  end if;
  if v_refuse then
    raise exception 'This screen is for another of your locations. Reload Business Mode.'
      using errcode = 'P0001', hint = 'business_selection_changed';
  end if;
  if v_unnamed then
    raise exception 'This version of Nearby can''t manage several locations. Update the app (or reload the website) to continue.'
      using errcode = 'P0001', hint = 'location_aware_client_required';
  end if;
end;
$$;
revoke all on function public.nearby_pre_request() from public;
grant execute on function public.nearby_pre_request() to anon, authenticated, service_role;
notify pgrst, 'reload config';

-- ===== Shared tables: refuse only the business-side row from an old client of a 2+-location account =====
create or replace function private._business_row_needs_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_table_name = 'stories' and new.partner_id is not null)
     or (tg_table_name = 'business_messages' and coalesce(new.from_business, false)) then
    if private._unnamed_multi_location_request() then
      raise exception 'This version of Nearby can''t manage several locations. Update the app (or reload the website) to continue.'
        using errcode = 'P0001', hint = 'location_aware_client_required';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private._business_row_needs_location() from public, anon, authenticated;
create trigger stories_business_row_needs_location
  before insert on public.stories
  for each row execute function private._business_row_needs_location();
create trigger business_messages_business_row_needs_location
  before insert on public.business_messages
  for each row execute function private._business_row_needs_location();

-- ===== Gatherings / communities: credited to a location only when the request named it (2+-location accounts) =====
create or replace function public.set_hosting_partner_from_host()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  partner_id_val uuid;
begin
  select managed_partner_id into partner_id_val from profiles where id = new.host_id;
  if partner_id_val is not null and private._location_count(new.host_id) >= 2
     and private._request_named_business() is distinct from partner_id_val then
    new.hosting_partner_id := null; -- several locations, none named: the person's own gathering
    return new;
  end if;
  if partner_id_val is not null then
    new.hosting_partner_id := partner_id_val;
  end if;
  return new;
end;
$$;

create or replace function public.set_community_hosting_partner_from_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  partner_id_val uuid;
begin
  select managed_partner_id into partner_id_val from profiles where id = new.creator_id;
  if partner_id_val is not null and private._location_count(new.creator_id) >= 2
     and private._request_named_business() is distinct from partner_id_val then
    new.hosting_partner_id := null;
    return new;
  end if;
  if partner_id_val is not null then
    new.hosting_partner_id := partner_id_val;
  end if;
  return new;
end;
$$;
