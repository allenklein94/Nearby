-- Item 146 pin averaging, Option A (owner approved 2026-10-17, LOCKED; B and C rejected). Assessment:
-- PRODUCT_AUDIT/ITEM_146_PIN_AVERAGING_ASSESSMENT_2026-10-17.md.
-- Before: private.gathering_pin = the precise point + an HMAC offset keyed by the GATHERING id, so every gathering at one
-- point had an independent offset and a host's repeated gatherings there (a weekly series = 52 pins a year) averaged out
-- toward the point (~30 m after a year).
-- This migration rebuilds the gathering pin on item 148's mechanism (private.location_pin, the same server-only secret):
--   1. private.gathering_location_pin(host, gathering, lat, lng) = private.location_pin('gathering', host, lat, lng): the
--      point's 0.007 deg grid cell, and a pin inside that cell chosen by the secret keyed by HOST + CELL. The pin depends
--      only on (host, cell), never on where in the cell the point is: every gathering a host holds in one cell shares one
--      pin, so averaging learns nothing beyond the cell (~780 m x ~700 m), and it is not an offset from the point, so
--      learning one gathering's real point (a cafe named in its title) reveals nothing about the host's other gatherings
--      in that cell (rejected option C would have). The 'gathering' scope never equals a story pin ('story'), so a host's
--      stories and gatherings are not linked by a shared pin. A gathering with no host keys on its own id.
--   2. private.gathering_pin is dropped (rebuilt, not layered: nothing can still call the per-gathering offset).
--   3. get_gathering_distances: distance_miles and fuzzed_lat/lng from the new pin (same signature, same grants, item 147's
--      row rule unchanged).
--   4. get_bounded_nearby_gathering_ids: the exact radius test stays on the pin ("inside the radius" = the pin is); the
--      bounding-box pre-filter on the indexed precise columns widens from 0.0035 to 0.007 deg, which covers every
--      pin-to-point distance (pin and point share one 0.007 cell), so no pin inside the radius is cut.
-- Behaviour (owner-accepted): a pin can sit up to ~1 km from the meet-up point; distance lines can shift up to ~0.5 mi;
-- every gathering pin moves once more; a host's gatherings in one cell stack on one pin (the map groups them on the client,
-- never a server-side per-gathering offset). get_gathering_meetup_point (host + approved attendees) and who may read
-- which row or column are unchanged.
-- Known residuals (documented, not changed here): a point within GPS jitter of a cell edge can show two neighbouring cells
-- across gatherings (as item 148); the readable `area` column (point rounded to 0.01 deg) intersected with the pin's cell can
-- narrow one axis (as it did with the old pin); count_gatherings_near_batch (item 146, public + discoverable only) still
-- counts on the precise point in a ~110 m box.

create or replace function private.gathering_location_pin(host_id uuid, gathering_id uuid, lat double precision, lng double precision,
  out pin_lat double precision, out pin_lng double precision)
 language sql
 stable
 set search_path to 'private'
as $function$
  select p.pin_lat, p.pin_lng
  from private.location_pin('gathering', coalesce(host_id::text, 'gathering:' || gathering_id::text), lat, lng) p;
$function$;
revoke execute on function private.gathering_location_pin(uuid, uuid, double precision, double precision) from public, anon, authenticated;

create or replace function public.get_gathering_distances(my_lat double precision, my_lng double precision, gathering_ids uuid[])
 returns table(id uuid, distance_miles double precision, fuzzed_lat double precision, fuzzed_lng double precision)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    g.id,
    (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(my_lat)) * cos(radians(p.pin_lat)) * cos(radians(p.pin_lng) - radians(my_lng)) +
        sin(radians(my_lat)) * sin(radians(p.pin_lat))
      ))
    )) as distance_miles,
    p.pin_lat as fuzzed_lat,
    p.pin_lng as fuzzed_lng
  from gatherings g
  cross join lateral private.gathering_location_pin(g.host_id, g.id, g.precise_lat, g.precise_lng) p
  where g.id = any(gathering_ids)
    and g.precise_lat is not null
    and g.precise_lng is not null
    and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id);
$function$;

create or replace function public.get_bounded_nearby_gathering_ids(my_lat double precision, my_lng double precision, max_miles double precision, row_limit integer default 500)
 returns table(id uuid)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select g.id
  from gatherings g
  where g.host_id <> auth.uid()
    and g.discoverable = true
    and g.scheduled_at > now()
    and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
    and (
      g.is_public = true
      or (
        g.precise_lat is not null
        and g.precise_lng is not null
        -- Bounding-box pre-filter on the indexed precise columns, widened by 0.007 deg (a pin and its point share one 0.007
        -- cell) so no pin inside the radius is cut; the exact test below runs on the pin, never the precise point.
        and g.precise_lat between my_lat - (max_miles / 69.0) - 0.007 and my_lat + (max_miles / 69.0) + 0.007
        and g.precise_lng between my_lng - (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01))) - 0.007
                              and my_lng + (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01))) + 0.007
        and exists (
          select 1 from private.gathering_location_pin(g.host_id, g.id, g.precise_lat, g.precise_lng) p
          where (3958.8 * acos(
              least(1.0, greatest(-1.0,
                cos(radians(my_lat)) * cos(radians(p.pin_lat)) * cos(radians(p.pin_lng) - radians(my_lng)) +
                sin(radians(my_lat)) * sin(radians(p.pin_lat))
              ))
            )) <= max_miles
        )
      )
    )
  order by g.scheduled_at asc
  limit row_limit;
$function$;

drop function if exists private.gathering_pin(uuid, double precision, double precision);
