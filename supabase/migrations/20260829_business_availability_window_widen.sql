-- Aug 29 2026 -- closes the one real (🔴) finding from the "global pagination ranking" audit
-- (item 12 of the re-audited P1/P2 remediation list -- see CLAUDE.md's own "Aug 29 2026 --
-- 'global pagination ranking' audit" section for the full trace/reasoning).
--
-- Real finding, confirmed by pulling the live function body directly (not inferred from an
-- older migration file): search_active_business_availability() capped its candidate pool at
-- `limit 6`, ordered by distance, BEFORE the client's own relevance scoring
-- (attributeAndCuisineBonus() in intentResolverScoring.js) ever runs. A posting ranked 7th-or-
-- later by raw distance could never reach the scorer even when it's the single best category/
-- cuisine/attribute match within the real 15-mile radius -- the literal "page 1 shows 92/89/87/85,
-- a genuine 99/97/95/94 sits unseen on page 2" anti-pattern the user's own example named, just
-- single-shot (one SQL call, not a second "page") rather than multi-page.
--
-- Locked fix, option (b) from the audit's own reasoning: widen the SQL-level candidate window so
-- the realistic eligible pool reaches the client before scoring runs, rather than porting the
-- real relevance formula into SQL (which would create a second, drift-prone copy of
-- intentResolverScoring.js's own single source of truth). `limit 6` -> `limit 30` -- a real,
-- generous bound matched to realistic near-term scale, not literally "unlimited" -- same
-- reasoning already applied to get_bounded_nearby_gathering_ids()'s 500 and
-- getPublicCommunities()'s 200. `order by distance_miles asc nulls last, ba.created_at desc`
-- stays exactly as-is (a reasonable pre-filter tiebreak for postings tied on real relevance
-- score) -- only the numeric cap changes. No other line of the function changes.
--
-- Same signature as before (category_param, latitude_param, longitude_param, radius_miles_param,
-- party_size_param) -- a plain CREATE OR REPLACE, no DROP FUNCTION needed since no parameter
-- changed.

create or replace function public.search_active_business_availability(
  category_param text default null,
  latitude_param double precision default null,
  longitude_param double precision default null,
  radius_miles_param double precision default 15,
  party_size_param integer default null
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
  distance_miles double precision,
  attributes text[],
  cuisine text,
  remaining_capacity integer
)
language sql
stable
security definer
set search_path = public
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
    end as distance_miles,
    p.attributes, p.cuisine, ba.remaining_capacity
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
$$;
