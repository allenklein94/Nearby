-- Item 81 (2026-09-26): capacity per SPACE, on top of item 80's overall max_group_size (all TOTAL people, owner-declared,
-- NULL = not said, never guessed):
--   private_room_capacity  -- counts only while the business declares `private_dining` (Private events)
--   outdoor_capacity       -- counts only while the business declares `outdoor_seating` (Outdoor dining)
-- A space can never be larger than the overall maximum when both are set (CHECK + clear setter messages).
-- Routing (_business_request_fanout): when the request itself asks for that space (its attributes carry private_dining /
-- outdoor_seating, e.g. a gathering whose host declared outdoor seating), the party size is ALSO checked against that space: a
-- known space too small goes last with the other too-small businesses; a known space that fits counts as covering. Unknown =
-- neutral. Never in any business-facing payload.

alter table public.brand_partners add column if not exists private_room_capacity integer;
alter table public.brand_partners add column if not exists outdoor_capacity integer;
alter table public.brand_partners drop constraint if exists brand_partners_private_room_capacity_check;
alter table public.brand_partners add constraint brand_partners_private_room_capacity_check
  check (private_room_capacity is null or (private_room_capacity between 1 and 5000 and (max_group_size is null or private_room_capacity <= max_group_size)));
alter table public.brand_partners drop constraint if exists brand_partners_outdoor_capacity_check;
alter table public.brand_partners add constraint brand_partners_outdoor_capacity_check
  check (outdoor_capacity is null or (outdoor_capacity between 1 and 5000 and (max_group_size is null or outdoor_capacity <= max_group_size)));

create or replace function public.set_business_space_capacity(partner_id_param uuid, space_param text, capacity_param integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_attrs text[]; v_max integer;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'Only the business owner can change this.';
  end if;
  if space_param not in ('private_room', 'outdoor') then
    raise exception 'Unknown space.';
  end if;
  select attributes, max_group_size into v_attrs, v_max from brand_partners where id = partner_id_param;
  if capacity_param is not null then
    if capacity_param < 1 or capacity_param > 5000 then
      raise exception 'Enter a group size between 1 and 5000, or leave it blank.';
    end if;
    if space_param = 'private_room' and not ('private_dining' = any(coalesce(v_attrs, '{}'))) then
      raise exception 'Add Private Dining to your profile first.';
    end if;
    if space_param = 'outdoor' and not ('outdoor_seating' = any(coalesce(v_attrs, '{}'))) then
      raise exception 'Add Outdoor Seating to your profile first.';
    end if;
    if v_max is not null and capacity_param > v_max then
      raise exception 'This space can''t hold more than your largest group (%). Raise that first.', v_max;
    end if;
  end if;
  if space_param = 'private_room' then
    update brand_partners set private_room_capacity = capacity_param where id = partner_id_param;
  else
    update brand_partners set outdoor_capacity = capacity_param where id = partner_id_param;
  end if;
end;
$$;
revoke all on function public.set_business_space_capacity(uuid, text, integer) from public, anon;
grant execute on function public.set_business_space_capacity(uuid, text, integer) to authenticated;

-- Same signature as 20270216; now refuses lowering the overall max below a space with a clear message (instead of the CHECK).
create or replace function public.set_business_max_group_size(partner_id_param uuid, max_group_size_param integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_room integer; v_out integer;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'Only the business owner can change this.';
  end if;
  if max_group_size_param is not null and (max_group_size_param < 1 or max_group_size_param > 5000) then
    raise exception 'Enter a group size between 1 and 5000, or leave it blank.';
  end if;
  select private_room_capacity, outdoor_capacity into v_room, v_out from brand_partners where id = partner_id_param;
  if max_group_size_param is not null and greatest(coalesce(v_room, 0), coalesce(v_out, 0)) > max_group_size_param then
    raise exception 'Your private room or outdoor area holds more than %. Lower that first.', max_group_size_param;
  end if;
  update brand_partners set max_group_size = max_group_size_param where id = partner_id_param;
end;
$$;
revoke all on function public.set_business_max_group_size(uuid, integer) from public, anon;
grant execute on function public.set_business_max_group_size(uuid, integer) to authenticated;

-- Routing: patched from the live body (the two item-80 keys become space-aware); guarded.
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text)'::regprocedure);
  v_new := replace(v_def, $q$p.offered_occasions, p.max_group_size, (3958.8$q$,
    $q$p.offered_occasions, p.max_group_size, p.private_room_capacity, p.outdoor_capacity, (3958.8$q$);
  v_new := replace(v_new, $q$      (v_req_party is not null and e.max_group_size is not null and e.max_group_size < v_req_party) asc,$q$,
    $q$      -- item 81: or the space the request asks for (private room / outdoor area, only while that capability is declared) is too small
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size < v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity < v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity < v_req_party))) asc,$q$);
  v_new := replace(v_new, $q$      (v_req_party is not null and e.max_group_size is not null and e.max_group_size >= v_req_party) desc,$q$,
    $q$      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size >= v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity >= v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity >= v_req_party))) desc,$q$);
  if position('p.private_room_capacity, p.outdoor_capacity' in v_new) = 0
     or position('e.private_room_capacity < v_req_party' in v_new) = 0 or position('e.outdoor_capacity >= v_req_party' in v_new) = 0 then
    raise exception '_business_request_fanout patch did not apply cleanly';
  end if;
  execute v_new;
end
$mig$;
revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text) from public, anon, authenticated;
