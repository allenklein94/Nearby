-- "10/10 blueprint" audit, Finding 8 (CLAUDE.md, Aug 30 2026): brand_partners.
-- accommodates_party_types (a business's own real declared party-shape
-- capability -- solo|friends|groups|date, the identical vocabulary
-- gatherings.party_type/business_requests.party_type already use, already
-- collected from the dashboard and already shown as real chips on
-- BusinessProfileScreen -- never reached any consumer-facing rank/match
-- stage. search_active_business_availability() (the RPC behind Tier 4-lite,
-- confirmed real business availability) already returns the identical
-- business row's own attributes/cuisine columns for exactly this purpose --
-- this widens it to also return accommodates_party_types, no new query, no
-- new table.
--
-- Return-shape change on a RETURNS TABLE function -- Postgres does not
-- allow CREATE OR REPLACE to change the return type, so the live signature
-- is dropped first (pulled fresh via the Management API before writing
-- this, not reconstructed from a possibly-stale local copy) and recreated
-- with the one new column. Every other line is byte-for-byte unchanged
-- from the live function.
drop function if exists search_active_business_availability(text, double precision, double precision, double precision, integer);

create function search_active_business_availability(category_param text default null, latitude_param double precision default null, longitude_param double precision default null, radius_miles_param double precision default 15, party_size_param integer default null)
returns table(id uuid, partner_id uuid, partner_name text, title text, description text, offer_type text, price numeric, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, distance_miles double precision, attributes text[], cuisine text, remaining_capacity integer, accommodates_party_types text[])
language sql
stable security definer
set search_path to 'public'
as $function$
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
    p.attributes, p.cuisine, ba.remaining_capacity, p.accommodates_party_types
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
$function$;

revoke all on function search_active_business_availability(text, double precision, double precision, double precision, integer) from public, anon;
grant execute on function search_active_business_availability(text, double precision, double precision, double precision, integer) to authenticated;
