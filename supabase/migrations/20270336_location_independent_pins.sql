-- Owner decisions 2026-10-22 (final, Option B + "Google as reference only"): Nearby never stores a Google coordinate or
-- Google-supplied business details. A Google result only moves the map (utils/locationProvenance.js); the stored point is the
-- one the person placed themselves ('host_pin'), the phone's own location ('device') or the business's own saved location
-- ('business_profile'); Google's place ID is kept only as a reference beside the person's own pin. Sign-up details are always
-- typed by the business ('business_entered'). Production held no row with any of the retired labels when this was written
-- (checked 2026-10-22: 0 gatherings / sign-ups / businesses with a location_source, details_source or google_place_id).

-- 1. Gatherings: the retired Google labels are refused; a place ID only beside the host's own pin.
alter table public.gatherings drop constraint if exists gatherings_location_source_check;
alter table public.gatherings add constraint gatherings_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin', 'business_profile')
);
alter table public.gatherings drop constraint if exists gatherings_google_place_id_source_check;
alter table public.gatherings add constraint gatherings_google_place_id_source_check check (
  google_place_id is null or location_source = 'host_pin'
);

-- 2. Business sign-up: details are the business's own; the pin is its own (or its phone's).
alter table public.business_partner_requests drop constraint if exists bpr_google_confirmed_check;
alter table public.business_partner_requests drop constraint if exists bpr_details_source_check;
alter table public.business_partner_requests add constraint bpr_details_source_check check (
  details_source is null or details_source = 'business_entered'
);
alter table public.business_partner_requests drop constraint if exists bpr_location_source_check;
alter table public.business_partner_requests add constraint bpr_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin')
);

-- 3. Businesses: same labels; a coordinate change that arrives without its own label (update_business_profile, a direct
--    owner write) is the business's own value: 'host_pin', place ID dropped (it described the old point). The app never
--    geocodes an address into a stored point any more ('address_geocoded' retired).
alter table public.brand_partners drop constraint if exists brand_partners_location_source_check;
alter table public.brand_partners add constraint brand_partners_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin')
);
alter table public.brand_partners drop constraint if exists brand_partners_google_place_id_source_check;
alter table public.brand_partners add constraint brand_partners_google_place_id_source_check check (
  google_place_id is null or location_source = 'host_pin'
);

create or replace function public._brand_partner_location_provenance()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- set_business_location labels its own write (a second pin keeps 'host_pin' + its new reference).
  if coalesce(current_setting('app.business_location_write', true), '') = 'on' then
    return new;
  end if;
  if (new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude)
     and new.location_source is not distinct from old.location_source then
    new.location_source := case when new.latitude is null and new.longitude is null then null else 'host_pin' end;
    new.google_place_id := null;
  end if;
  return new;
end;
$function$;
revoke all on function public._brand_partner_location_provenance() from public, anon, authenticated;

-- 4. The business places its own pin (Business profile -> "Place your business on the map"): the ONE write of a business's
--    point with its provenance. Only the business's own manager; a real point; source 'host_pin' (placed on the map, may
--    carry the Google place ID it searched for, as a reference) or 'device' (its phone's location, no place ID).
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
  if location_source_param is null or location_source_param not in ('host_pin', 'device') then
    raise exception 'Unknown location source' using errcode = '22023';
  end if;
  perform set_config('app.business_location_write', 'on', true);
  update brand_partners
  set latitude = latitude_param, longitude = longitude_param, location_source = location_source_param,
      google_place_id = case when location_source_param = 'host_pin' then nullif(trim(google_place_id_param), '') end
  where id = partner_id_param;
  perform set_config('app.business_location_write', 'off', true);
end;
$function$;
revoke all on function public.set_business_location(uuid, double precision, double precision, text, text) from public, anon;
grant execute on function public.set_business_location(uuid, double precision, double precision, text, text) to authenticated;
