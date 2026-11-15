-- Rollback of 20270419 (business service area). Refuses while any row is labelled 'service_area': those businesses would
-- otherwise be left with a label the restored check rejects (relabel or clear them first, with the owner's approval).
do $$
begin
  if exists (select 1 from public.brand_partners where location_source = 'service_area')
     or exists (select 1 from public.business_partner_requests where location_source = 'service_area') then
    raise exception 'service_area rows exist: relabel them before rolling back 20270419' using hint = 'service_area_present';
  end if;
end $$;

drop trigger if exists bpr_carry_service_area_on_approval on public.business_partner_requests;
drop function if exists public._carry_service_area_on_approval();
drop trigger if exists brand_partner_service_area_guard on public.brand_partners;
drop trigger if exists bpr_service_area_guard on public.business_partner_requests;
drop function if exists public._service_area_location_guard();

alter table public.business_partner_requests drop constraint if exists bpr_location_source_check;
alter table public.business_partner_requests add constraint bpr_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin')
);
alter table public.brand_partners drop constraint if exists brand_partners_location_source_check;
alter table public.brand_partners add constraint brand_partners_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin')
);
-- The 20270336 version of set_business_location.
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
