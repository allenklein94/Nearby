-- Consumer-side discovery for "Occasions we offer" (20270101).
--
-- 1. search_occasion_offering_businesses: businesses that EXPLICITLY offer a given occasion, near the caller,
--    whether or not they have a package or a live availability posting. Returns only public-facing fields
--    (id, name, distance) -- the resolver surfaces them as a weak "may be able to help" tier that is never
--    shown as confirmed inventory and is de-duplicated behind a live posting or a package.
-- 2. search_active_business_availability gains a trailing offered_occasions column so a live posting from a
--    business that offers the occasion is credited like one that wants it. A RETURNS TABLE change cannot be
--    done with CREATE OR REPLACE: the old function is dropped first (single overload, same grants).

create or replace function public.search_occasion_offering_businesses(
  occasion_param text,
  latitude_param double precision default null,
  longitude_param double precision default null,
  radius_miles_param double precision default 15
)
returns table(partner_id uuid, partner_name text, distance_miles double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.id as partner_id,
    p.name as partner_name,
    (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) as distance_miles
  from brand_partners p
  where occasion_param is not null
  and p.active = true
  and occasion_param = any(p.offered_occasions)
  and latitude_param is not null and longitude_param is not null
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  order by distance_miles asc
  limit 6;
$function$;

revoke all on function public.search_occasion_offering_businesses(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.search_occasion_offering_businesses(text, double precision, double precision, double precision) to authenticated, service_role;

drop function if exists public.search_active_business_availability(text, double precision, double precision, double precision, integer);

CREATE OR REPLACE FUNCTION public.search_active_business_availability(category_param text DEFAULT NULL::text, latitude_param double precision DEFAULT NULL::double precision, longitude_param double precision DEFAULT NULL::double precision, radius_miles_param double precision DEFAULT 15, party_size_param integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, partner_id uuid, partner_name text, title text, description text, offer_type text, price numeric, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, distance_miles double precision, attributes text[], cuisine text, remaining_capacity integer, accommodates_party_types text[], priority_occasions text[], subcategory text, categories text[], bundle_occasion text, bundle_components text[], offered_occasions text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    ba.id, ba.partner_id, p.name as partner_name, ba.title, ba.description,
    ba.offer_type, ba.price, ba.category, ba.starts_at, ba.ends_at,
    case
      when latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null then null
      else (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      ))
    end as distance_miles,
    p.attributes, p.cuisine, ba.remaining_capacity, p.accommodates_party_types, p.priority_occasions, p.subcategory,
    p.categories, ba.bundle_occasion, ba.bundle_components, p.offered_occasions
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
  and (category_param is null or ba.category is null or ba.category = category_param)
  and (
    latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null
    or (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
  )
  order by distance_miles asc nulls last, ba.created_at desc
  limit 30;
$function$
;

revoke all on function public.search_active_business_availability(text, double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.search_active_business_availability(text, double precision, double precision, double precision, integer) to authenticated, service_role;
