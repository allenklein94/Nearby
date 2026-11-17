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
--   * Not location-specific, so never refused here:
--       - person-level functions: every reference to the selection is only "is this person a business owner?"
--         (managed_partner_id is [not] null), decided from the catalog (set_my_notification_group,
--         set_my_business_email_enabled, get_gathering_group_insights today);
--       - object-bound functions customers also call: complete_business_reservation, cancel_business_reservation act
--         as the business only when the selection equals THAT offer's own location (else as the requester, or refused),
--         so they can never write to another location;
--       - approve_business_partner_request (an admin action on someone else's application).
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

-- Does this function act for "the selected location", itself OR through what it calls? (owner 2026-11-17: the trust stack
-- wraps business functions, e.g. create_occasion_package = screening + private.create_occasion_package_unscreened, and gets
-- the location from private._caller_partner(); a rule reading only the function's own body missed 8 of them.)
-- Walks from this one function into the public/private SQL + plpgsql functions its body calls (by name, every overload,
-- max 8 levels). A function in the walk counts when it reads the selection for more than "is this person a business
-- owner?" (a null check). Not followed: recovery functions, the object-bound customer functions (they act only for the
-- offer's own location) and read-only yes/no checks (stable boolean: visibility gates such as viewer_may_read_profile,
-- _gathering_row_visible: they decide what may be seen, never act for a location). Cost: only for a signed-in write
-- without a named location from a 2+-location account (a few ms).
create or replace function private._selection_reaching_function(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive w(name, depth) as (
    select p_name collate "C", 0
    union
    select (m)[1]::text collate "C", w.depth + 1
    from w
    join pg_proc p on p.proname = w.name
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang,
    regexp_matches(p.prosrc, '\m([a-z_][a-z0-9_]*)\s*\(', 'g') m
    where n.nspname in ('public', 'private') and p.prokind = 'f' and l.lanname in ('sql', 'plpgsql') and w.depth < 8
      and (w.depth = 0 or not (p.prorettype = 'boolean'::regtype and p.provolatile <> 'v'))
      and (m)[1] not in ('select_managed_business', 'get_my_businesses', 'note_location_aware_session', 'nearby_pre_request',
                         'my_managed_partner_id', 'complete_business_reservation', 'cancel_business_reservation',
                         'approve_business_partner_request')
  )
  select exists (
    select 1 from w
    join pg_proc p on p.proname = w.name
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and (w.depth = 0 or not (p.prorettype = 'boolean'::regtype and p.provolatile <> 'v'))
      and (select count(*) from regexp_matches(p.prosrc, '(managed_partner_id|my_managed_partner_id\(\))', 'g'))
        > (select count(*) from regexp_matches(p.prosrc, '(managed_partner_id|my_managed_partner_id\(\))\s+is\s+(not\s+)?null', 'gi')));
$$;
revoke all on function private._selection_reaching_function(text) from public, anon, authenticated;

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
                  'my_managed_partner_id', 'complete_business_reservation', 'cancel_business_reservation',
                  'approve_business_partner_request') then
      return false;
    end if;
    -- acts for the selection itself or through a function it calls (private._selection_reaching_function)
    return exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_name and p.prokind = 'f')
      and private._selection_reaching_function(v_name);
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
-- Named a_* so they run before the tables' other BEFORE triggers (alphabetical): the location answer comes first.
create or replace function private._business_row_needs_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- to_jsonb: one function for both tables (each lacks the other's column)
  if (tg_table_name = 'stories' and to_jsonb(new) ->> 'partner_id' is not null)
     or (tg_table_name = 'business_messages' and coalesce((to_jsonb(new) ->> 'from_business')::boolean, false)) then
    if private._unnamed_multi_location_request() then
      raise exception 'This version of Nearby can''t manage several locations. Update the app (or reload the website) to continue.'
        using errcode = 'P0001', hint = 'location_aware_client_required';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private._business_row_needs_location() from public, anon, authenticated;
create trigger a_stories_business_row_needs_location
  before insert on public.stories
  for each row execute function private._business_row_needs_location();
create trigger a_business_messages_business_row_needs_location
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
