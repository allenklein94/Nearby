-- Business location at sign-up (owner, 2026-11-15): a storefront business gives its address + its own pin; a business that
-- goes to its customers ("We go to customers": mobile / service-area) gives only ROUGHLY where it is based.
-- Reuses the existing columns (brand_partners / business_partner_requests latitude, longitude, address, location_source): a
-- service-area point is location_source 'service_area', and this migration guarantees, in the database, that such a row
--   * never holds an address (brand_partners.address is readable by every signed-in person),
--   * never holds a Google place ID,
--   * holds its point rounded to 2 decimals (~1 km, about half a mile across), never the exact pin it was placed from.
-- Routing and distance keep reading the same latitude/longitude (unchanged), so the business still receives nearby requests;
-- the app shows no map pin, no directions and no "Go now" for it (utils/businessLocationMode.js).
-- No new column, no change to routing, approval or update_business_profile. Builds <= 87 never send 'service_area'.

-- 1. The label is allowed on both tables.
alter table public.business_partner_requests drop constraint if exists bpr_location_source_check;
alter table public.business_partner_requests add constraint bpr_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin', 'service_area')
);
alter table public.brand_partners drop constraint if exists brand_partners_location_source_check;
alter table public.brand_partners add constraint brand_partners_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin', 'service_area')
);

-- 2. The guard: whatever writes a service-area row (sign-up insert, approval's copy, set_business_location, a direct write),
--    the stored row is rounded, address-free and place-ID-free. Never raises: it makes the row safe. A label with no point
--    is kept (the business has said it goes to its customers but has not marked its area yet).
--    On brand_partners it runs after brand_partner_location_provenance (triggers fire in name order), so a moved point that
--    the provenance trigger relabels 'host_pin' is a storefront pin and left alone.
create or replace function public._service_area_location_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.location_source = 'service_area' then
    -- No point yet (a website application: the area is marked in the dashboard after approval) keeps the label, so the
    -- dashboard asks for a service area, never an address. Only a point is rounded.
    if new.latitude is not null and new.longitude is not null then
      new.latitude := round(new.latitude::numeric, 2)::double precision;
      new.longitude := round(new.longitude::numeric, 2)::double precision;
    else
      new.latitude := null;
      new.longitude := null;
    end if;
    new.address := null;
    new.google_place_id := null;
  end if;
  return new;
end;
$function$;
revoke all on function public._service_area_location_guard() from public, anon, authenticated;

drop trigger if exists brand_partner_service_area_guard on public.brand_partners;
create trigger brand_partner_service_area_guard
  before insert or update on public.brand_partners
  for each row execute function public._service_area_location_guard();

drop trigger if exists bpr_service_area_guard on public.business_partner_requests;
create trigger bpr_service_area_guard
  before insert or update on public.business_partner_requests
  for each row execute function public._service_area_location_guard();

-- 2b. Approval (approve_business_partner_request, unchanged) copies location_source only when the application has a point,
--     so a website application that said "We go to customers" (no point, no address) would lose its label. This copies the
--     label onto the new business at the moment the application is approved, only while that business still has no point.
create or replace function public._carry_service_area_on_approval()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.resulting_partner_id is not null
     and new.location_source = 'service_area' then
    update brand_partners set location_source = 'service_area', address = null, google_place_id = null
    where id = new.resulting_partner_id and latitude is null and longitude is null;
  end if;
  return new;
end;
$function$;
revoke all on function public._carry_service_area_on_approval() from public, anon, authenticated;

drop trigger if exists bpr_carry_service_area_on_approval on public.business_partner_requests;
create trigger bpr_carry_service_area_on_approval
  after update of status on public.business_partner_requests
  for each row execute function public._carry_service_area_on_approval();

-- 3. The owner's own location write (Business Mode > Business address) accepts the new label. Same signature, same grants;
--    a service-area write also clears the stored address (the guard does it; stated here so the intent is in one place).
create or replace function public.set_business_location(partner_id_param uuid, latitude_param double precision,
  longitude_param double precision, location_source_param text, google_place_id_param text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  if latitude_param is null or longitude_param is null or latitude_param not between -90 and 90 or longitude_param not between -180 and 180 then
    raise exception 'A location on the map is required' using errcode = '22023';
  end if;
  if location_source_param is null or location_source_param not in ('host_pin', 'device', 'service_area') then
    raise exception 'Unknown location source' using errcode = '22023';
  end if;
  perform set_config('app.business_location_write', 'on', true);
  update brand_partners
  set latitude = latitude_param, longitude = longitude_param, location_source = location_source_param,
      google_place_id = case when location_source_param = 'host_pin' then nullif(trim(google_place_id_param), '') end,
      address = case when location_source_param = 'service_area' then null else address end
  where id = partner_id_param;
  perform set_config('app.business_location_write', 'off', true);
end;
$function$;
revoke all on function public.set_business_location(uuid, double precision, double precision, text, text) from public, anon;
grant execute on function public.set_business_location(uuid, double precision, double precision, text, text) to authenticated;
