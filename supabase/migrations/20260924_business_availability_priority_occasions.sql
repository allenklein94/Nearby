-- Intent engine vision, first increment (2026-09-06, CLAUDE.md's Active
-- section / memory project_intent_engine_vision): create-assistant's own
-- classification has extracted a real `occasion` (birthday/anniversary/
-- date_night/celebration/casual_hangout/business_meal/family_gathering)
-- from the ask box's free text since the "Intelligent demand inbox" Phase 1
-- pass (Sep 3 2026, business_requests.occasion), but resolveIntent()
-- (src/services/intentResolver.js) had nothing to score it against for
-- confirmed live business availability -- search_active_business_availability
-- already returns a business's own real attributes/cuisine (from
-- brand_partners) but not its priority_occasions, the one existing "what
-- occasions does this business want more of" signal
-- (20260903_business_dna_goals_pulse.sql's set_business_priority_attributes()
-- writes it). This is a pure additive column on an existing, already-live
-- function -- every other line is byte-for-byte the version live today
-- (confirmed via pg_get_functiondef before writing this), so no existing
-- caller (positional or named) is broken by the new trailing column.
--
-- Postgres does not allow CREATE OR REPLACE to change a function's return
-- type (RETURNS TABLE's column list counts as the return type) -- a real
-- drop-then-create is required here, unlike this same taxonomy pass's
-- other migrations that only changed a CHECK constraint's value list.
drop function if exists public.search_active_business_availability(text, double precision, double precision, double precision, integer);

create function public.search_active_business_availability(
  category_param text default null,
  latitude_param double precision default null,
  longitude_param double precision default null,
  radius_miles_param double precision default 15,
  party_size_param integer default null
)
returns table(
  id uuid, partner_id uuid, partner_name text, title text, description text,
  offer_type text, price numeric, category text, starts_at timestamp with time zone,
  ends_at timestamp with time zone, distance_miles double precision,
  attributes text[], cuisine text, remaining_capacity integer,
  accommodates_party_types text[], priority_occasions text[]
)
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
    p.attributes, p.cuisine, ba.remaining_capacity, p.accommodates_party_types, p.priority_occasions
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

revoke all on function public.search_active_business_availability(text, double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.search_active_business_availability(text, double precision, double precision, double precision, integer) to authenticated;
