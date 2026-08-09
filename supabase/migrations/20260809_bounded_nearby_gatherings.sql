-- Bounds getNearbyGatherings()'s browse query at the SQL level, both by row
-- count and (where the product design allows it) by geography.
--
-- Before this: getNearbyGatherings() ran
--   select ... from gatherings where host_id <> me and scheduled_at > now()
-- with no LIMIT and no geographic WHERE clause at all — every future
-- gathering in the entire table was downloaded to the client, every time,
-- regardless of table size, and distance/tier filtering only happened
-- afterward in JavaScript. Invisible today (5 real gatherings in
-- production) but the real "download 50,000 rows" problem at scale.
--
-- A plain radius bound can't be the fix on its own: commit dd576983
-- ("Public gatherings are now visible regardless of distance, private
-- gatherings stay tiered by radius") is a deliberate product decision,
-- still enforced today in enrichGatheringsWithDistanceAndSort()'s own
-- `gathering.is_public || gathering.distanceMiles <= maxMiles` filter — a
-- naive "WHERE within max_miles" would silently break that and hide public
-- gatherings the app is supposed to keep showing network-wide.
--
-- get_bounded_nearby_gathering_ids() replicates that exact same rule
-- server-side instead: is_public rows pass through regardless of distance,
-- non-public (host-approval) rows are geographically bounded by max_miles
-- (a real bounding-box pre-filter on precise_lat/precise_lng, backed by the
-- new index below, then the same haversine formula get_gathering_distances
-- already uses for the final precise check) — and everything is capped by
-- a hard row_limit, ordered by soonest-upcoming, so the query can never
-- return more than row_limit ids no matter how large the table grows.
-- Combined with gatherings_scheduled_at_idx, Postgres can satisfy the
-- `scheduled_at > now() order by scheduled_at asc limit row_limit` shape
-- with an index scan that stops once row_limit matches are found, instead
-- of a full sequential scan + in-memory sort.
--
-- Only returns ids (never precise_lat/precise_lng themselves, matching the
-- same privacy posture get_gathering_distances already established) — the
-- client does a second bounded `.in('id', candidateIds)` select for the
-- real row data, same two-step shape searchGatherings() already uses.

create index if not exists gatherings_scheduled_at_idx on public.gatherings (scheduled_at);
create index if not exists gatherings_precise_lat_lng_idx on public.gatherings (precise_lat, precise_lng);

create or replace function public.get_bounded_nearby_gathering_ids(
  my_lat double precision,
  my_lng double precision,
  max_miles double precision,
  row_limit integer default 500
)
returns table(id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  select g.id
  from gatherings g
  where g.host_id <> auth.uid()
    and g.scheduled_at > now()
    and (
      g.is_public = true
      or (
        g.precise_lat is not null
        and g.precise_lng is not null
        -- Bounding-box pre-filter (1 degree latitude ~= 69 miles) so the
        -- index on (precise_lat, precise_lng) can narrow candidates before
        -- the exact trig distance check below runs.
        and g.precise_lat between my_lat - (max_miles / 69.0) and my_lat + (max_miles / 69.0)
        and g.precise_lng between my_lng - (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01)))
                              and my_lng + (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01)))
        and (3958.8 * acos(
              least(1.0, greatest(-1.0,
                cos(radians(my_lat)) * cos(radians(g.precise_lat)) * cos(radians(g.precise_lng) - radians(my_lng)) +
                sin(radians(my_lat)) * sin(radians(g.precise_lat))
              ))
            )) <= max_miles
      )
    )
  order by g.scheduled_at asc
  limit row_limit;
$function$;

revoke all on function public.get_bounded_nearby_gathering_ids(double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.get_bounded_nearby_gathering_ids(double precision, double precision, double precision, integer) to authenticated;
