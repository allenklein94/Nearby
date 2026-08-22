-- Closes the first of the two remaining locked decisions recorded in CLAUDE.md's Aug 23 2026
-- "Offer System outcome capture" section: policy-only businesses (a real, standing
-- business_fulfillment_policies row, Offer System Phase 2) are currently invisible to the
-- consumer resolver -- only a business's manually-posted business_availability shows up as a
-- candidate today. Per direct instruction: rank policy-only candidates below confirmed live
-- postings, never label one "Available," and keep the ordering deterministic (confirmed live >
-- policy-only) rather than a special-cased tie-break.
--
-- This mirrors search_active_business_availability's own shape (a narrow, read-only,
-- SECURITY DEFINER RPC over an owner-scoped table, same reasoning: a business's own standing
-- fulfillment terms are intentionally discoverable supply, same posture as a manual
-- availability posting -- businesses are not subject to the no-stranger-discovery rule) rather
-- than a broadened SELECT policy on business_fulfillment_policies.
--
-- Eligibility deliberately mirrors _match_request_to_policy()'s own real matching criteria
-- exactly (active = true, auto_accept_party_size_max is not null, party-size bounds) -- a
-- policy without auto_accept_party_size_max set can never actually auto-match a real request
-- today (see _match_request_to_policy's own body), so surfacing one here would be a false
-- "may be available" promise nothing downstream could ever honor. No category filter --
-- business_fulfillment_policies has none (a whole-business standing rule, not a per-posting
-- one, per that table's own migration comment) -- and no active_hours check, since the resolver
-- only ever has a coarse date_window at this point, not a precise time window; the real hours
-- check still runs for real inside _match_request_to_policy at submission time.

create or replace function public.search_policy_only_businesses(
  latitude_param double precision default null,
  longitude_param double precision default null,
  radius_miles_param double precision default 15,
  party_size_param integer default null
)
returns table (
  partner_id uuid,
  partner_name text,
  distance_miles double precision
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    bfp.partner_id,
    p.name as partner_name,
    case
      when latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null then null
      else (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      ))
    end as distance_miles
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true
  where bfp.active = true
  and bfp.auto_accept_party_size_max is not null
  and p.latitude is not null and p.longitude is not null
  and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
  and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
  and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
  and (
    latitude_param is null or longitude_param is null
    or (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
  )
  order by distance_miles asc nulls last, bfp.created_at desc
  limit 6;
$$;

revoke all on function public.search_policy_only_businesses(double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.search_policy_only_businesses(double precision, double precision, double precision, integer) to authenticated;
