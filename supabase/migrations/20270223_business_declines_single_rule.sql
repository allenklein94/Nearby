-- Item 86 follow-up (owner, 2026-09-26): ONE compatibility rule for every path. Canonical flow:
--   customer intent -> compatibility check -> eligible businesses -> ranking -> request/offer
-- `_business_declines(partner, facts...)` is the only place the conflicts are decided. It is used by:
--   * `_business_declines_request` (routing fan-out + the three auto-offer matchers, from the request's own structured fields)
--   * `get_declined_businesses` (typed asks: the client only turns the person's WORDS into facts and asks the server)
-- A request the customer addressed to ONE business (_route_request_to_partner) never passes through it.
-- Facts are explicit only: the caller passes what the person said (or the request's own chosen fields); nothing is inferred here.
-- Returns the first conflict key (children | pets | group | indoor_only | outdoor_only | booking) or null (compatible / unknown).

create or replace function public._business_declines(
  partner_id_param uuid,
  party_size_param integer,
  children_param boolean,
  pets_param boolean,
  wants_outdoor_param boolean,
  wants_indoor_param boolean,
  walk_in_param boolean
)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when coalesce(children_param, false) and coalesce(p.not_accommodated, '{}') && array['no_children', 'adults_21_plus'] then 'children'
    when coalesce(pets_param, false) and 'no_pets' = any(coalesce(p.not_accommodated, '{}')) then 'pets'
    when party_size_param is not null and p.max_group_size is not null and p.max_group_size < party_size_param then 'group'
    when coalesce(wants_outdoor_param, false) and p.weather_setting = 'indoor' then 'indoor_only'
    when coalesce(wants_indoor_param, false) and p.weather_setting = 'outdoor' then 'outdoor_only'
    -- booking mode precedence mirrors constants/bookingMode.js: the declared mode, else the legacy attribute
    when coalesce(walk_in_param, false)
         and coalesce(p.booking_mode, case when 'reservation_required' = any(coalesce(p.attributes, '{}')) then 'reservation_required' end)
             in ('reservation_required', 'request_required') then 'booking'
  end
  from brand_partners p
  where p.id = partner_id_param;
$$;
revoke all on function public._business_declines(uuid, integer, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;

-- Same signature as before (callers unchanged); now a thin wrapper over the one rule.
create or replace function public._business_declines_request(partner_id_param uuid, request_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select public._business_declines(
      partner_id_param,
      r.party_size,
      coalesce(r.attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'],
      coalesce(r.attributes, '{}') && array['dog_friendly', 'pet_friendly'],
      'outdoor_seating' = any(coalesce(r.attributes, '{}')),
      false,
      false
    ) is not null
    from business_requests r
    where r.id = request_id_param
  ), false);
$$;
revoke all on function public._business_declines_request(uuid, uuid) from public, anon, authenticated;

-- Typed asks. Returns only the businesses that conflict, with the reason; everything else (including unknown ids) is compatible.
create or replace function public.get_declined_businesses(
  partner_ids_param uuid[],
  party_size_param integer default null,
  children_param boolean default false,
  pets_param boolean default false,
  wants_outdoor_param boolean default false,
  wants_indoor_param boolean default false,
  walk_in_param boolean default false
)
returns table (partner_id uuid, reason text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select x.id, x.reason
  from (
    select id, public._business_declines(id, party_size_param, children_param, pets_param, wants_outdoor_param, wants_indoor_param, walk_in_param) as reason
    from (select distinct unnest(partner_ids_param[1:100]) as id) ids
  ) x
  where auth.uid() is not null and x.reason is not null;
$$;
revoke all on function public.get_declined_businesses(uuid[], integer, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_declined_businesses(uuid[], integer, boolean, boolean, boolean, boolean, boolean) to authenticated;
