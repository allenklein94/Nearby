-- Rollback of 20270427 (location-aware client required for 2+-location accounts). Restores 20270426's pre-request check
-- verbatim (the old-build window returns: a client that names no location acts for the selection), the original
-- gathering / community crediting triggers (search_path = public, as before), and drops the shared-table row triggers
-- and helpers. No data to keep (0427 stores nothing).
drop trigger if exists a_stories_business_row_needs_location on public.stories;
drop trigger if exists a_business_messages_business_row_needs_location on public.business_messages;
drop function if exists private._business_row_needs_location();

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

create or replace function public.set_hosting_partner_from_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  partner_id_val uuid;
begin
  select managed_partner_id into partner_id_val from profiles where id = new.host_id;
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
set search_path = public
as $$
declare
  partner_id_val uuid;
begin
  select managed_partner_id into partner_id_val from profiles where id = new.creator_id;
  if partner_id_val is not null then
    new.hosting_partner_id := partner_id_val;
  end if;
  return new;
end;
$$;

drop function if exists private._unnamed_multi_location_request();
drop function if exists private._request_named_business();
drop function if exists private._location_scoped_path(text);
drop function if exists public._account_location_count(uuid);
drop function if exists private._location_count(uuid);
notify pgrst, 'reload config';
