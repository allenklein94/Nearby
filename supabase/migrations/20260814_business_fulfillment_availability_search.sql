-- Intent Layer resolver integration fix (see
-- PRODUCT_AUDIT/INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md). That audit
-- found the business request/offer engine was structurally a dead-end
-- fallback in intentResolver.js -- never queried as a real candidate,
-- only reachable when gatherings/friend-asks/perks combined returned
-- nothing. Meanwhile business_availability (Phase 4's "proactive business
-- availability" postings) already exists as real, synchronously-queryable
-- supply that was never wired into the resolver at all.
--
-- This closes that gap the honest way: a narrow, read-only RPC so the
-- resolver can search *already-posted* standing availability the same way
-- it already searches gatherings/perks -- as a real candidate scored and
-- ranked alongside everything else, not a fallback. business_availability
-- has owner-only SELECT RLS (see 20260814_business_fulfillment_
-- availability.sql), so this can't be a direct client query; it needs the
-- same "narrow SECURITY DEFINER RPC returning only what's displayed"
-- shape get_connected_open_business_requests already established.
--
-- Public-safe: a business's own posted availability is intentionally
-- discoverable supply, same posture this schema already takes for
-- brand_offers/get_nearby_offer_ids -- businesses are not subject to the
-- no-stranger-discovery rule, only people are.
--
-- Distance math is the identical haversine formula
-- _match_request_to_availability() already uses server-side, kept
-- consistent rather than approximated differently here.

create or replace function public.search_active_business_availability(
  category_param text default null,
  latitude_param double precision default null,
  longitude_param double precision default null,
  radius_miles_param double precision default 15
)
returns table (
  id uuid,
  partner_id uuid,
  partner_name text,
  title text,
  description text,
  offer_type text,
  price numeric,
  category text,
  starts_at timestamptz,
  ends_at timestamptz,
  distance_miles double precision
)
language sql
stable
security definer
set search_path to 'public'
as $$
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
    end as distance_miles
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
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
  limit 6;
$$;

revoke all on function public.search_active_business_availability(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.search_active_business_availability(text, double precision, double precision, double precision) to authenticated;
