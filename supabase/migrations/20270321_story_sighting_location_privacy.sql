-- Item 148 (owner, approved 2026-10-17, D1-D4 LOCKED): Nearby never stores a story's or a sighting's precise location,
-- because no product feature needs it. Scope + live findings: PRODUCT_AUDIT/ITEM_148_STORY_SIGHTING_LOCATION_SCOPE_2026-10-17.md.
-- Found live (rolled back) before this migration:
--   S1 any signed-in user read a live public story's / business moment's exact GPS point (stories.latitude/longitude,
--      table-wide SELECT + the stories RLS policy);
--   S2 get_public_stories_with_fuzzed_coords' pin = point + an offset from md5(id): anyone could subtract it;
--   S3 a sighting's other participant read approx_area at 4 decimals (~11 m); get_sighting_fuzzed_coords (no caller since
--      2026-07-28) used the same reversible md5 offset.
-- This migration:
--   1. (D1 + D2) private.location_pin(): the point's cell on a fixed 0.007 deg grid (~780 m x ~700 m in South Palm Beach)
--      and a pin inside that cell chosen by item 146's server-only secret (private.pin_secret), keyed by WHO + the CELL,
--      never the post. The pin depends only on (person, cell), never on where in the cell the point was, so posting again
--      from the same place returns the same pin and averaging many posts learns nothing beyond the cell. The pin sits in
--      the middle 90% of the cell, so pinning a pin returns itself (idempotent).
--      Known residual (documented): a place within GPS jitter of a cell edge can land in two neighbouring cells across
--      posts; two pins then show the point is near their shared edge (one axis narrowed, never a point unless at a corner).
--   2. A BEFORE INSERT/UPDATE trigger on stories replaces latitude/longitude with the pin before the row is written: the
--      exact point is never persisted. (D3) A business moment (partner_id set) stores no location at all. Invalid or half
--      coordinates store nothing.
--   3. (D4) A BEFORE INSERT/UPDATE trigger on sightings replaces approx_area with the pin of the pair (keyed by both people,
--      order-independent) at 6 decimals; unparseable values store nothing.
--   4. Defence in depth (never the fix itself): client SELECT on stories.latitude/longitude and sightings.approx_area is
--      removed (column allowlists). FORWARD RULE: a migration adding a column to stories or sightings must also
--      `grant select (<column>) ... to anon, authenticated` (guard: src/utils/storySightingLocationGuard.test.js).
--   5. get_public_stories_with_fuzzed_coords returns the stored pin as is (same signature, same grants).
--   6. get_sighting_fuzzed_coords is dropped (no caller anywhere since 2026-07-28; the sighting map pins have been empty
--      since then and stay so).
--   7. Existing rows are pinned in place (prod at build time: 0 stories, 1 sighting).
-- NOT in this item: story media metadata (EXIF GPS) - deferred until a real-device test shows whether it exists; item 146's
-- gathering pin (keyed per gathering, so averageable across many gatherings hosted from one point) - documented, not reopened.

-- 1. The stable, secret-keyed pin ----------------------------------------------------------------------------------------
create or replace function private.location_pin(key_scope text, owner_key text, lat double precision, lng double precision,
  out pin_lat double precision, out pin_lng double precision)
 language sql
 stable
 set search_path to 'private'
as $function$
  select (c.ci + 0.05 + 0.9 * ((get_byte(k.h, 0) * 256 + get_byte(k.h, 1)) / 65536.0)) * 0.007,
         (c.cj + 0.05 + 0.9 * ((get_byte(k.h, 2) * 256 + get_byte(k.h, 3)) / 65536.0)) * 0.007
  from (select floor(lat / 0.007)::bigint ci, floor(lng / 0.007)::bigint cj) c
  cross join lateral (
    select extensions.hmac(convert_to(key_scope || ':' || owner_key || ':' || c.ci || ':' || c.cj, 'UTF8'), s.secret, 'sha256') h
    from private.pin_secret s
  ) k;
$function$;
revoke execute on function private.location_pin(text, text, double precision, double precision) from public, anon, authenticated;

-- 2. Stories store only the pin; business moments store nothing -----------------------------------------------------------
create or replace function private.story_location_to_pin()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'private'
as $function$
declare
  v_pin record;
begin
  if new.partner_id is not null
     or new.latitude is null or new.longitude is null
     or new.latitude not between -90 and 90 or new.longitude not between -180 and 180
     or new.latitude = 'NaN'::double precision or new.longitude = 'NaN'::double precision then
    new.latitude := null;
    new.longitude := null;
    return new;
  end if;
  select * into v_pin from private.location_pin('story', new.user_id::text, new.latitude, new.longitude);
  new.latitude := v_pin.pin_lat;
  new.longitude := v_pin.pin_lng;
  return new;
end;
$function$;
revoke execute on function private.story_location_to_pin() from public, anon, authenticated;

drop trigger if exists story_location_to_pin on public.stories;
create trigger story_location_to_pin
  before insert or update of latitude, longitude, partner_id, user_id on public.stories
  for each row execute function private.story_location_to_pin();

-- 3. Sightings store only the pair's pin -------------------------------------------------------------------------------------
create or replace function private.sighting_area_to_pin()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'private'
as $function$
declare
  v_lat double precision;
  v_lng double precision;
  v_pin record;
begin
  if new.approx_area is null then
    return new;
  end if;
  begin
    v_lat := split_part(new.approx_area, ',', 1)::double precision;
    v_lng := split_part(new.approx_area, ',', 2)::double precision;
  exception when others then
    v_lat := null;
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or v_lat = 'NaN'::double precision or v_lng = 'NaN'::double precision then
    new.approx_area := null;
    return new;
  end if;
  select * into v_pin from private.location_pin('sighting',
    least(new.user_a, new.user_b)::text || ':' || greatest(new.user_a, new.user_b)::text, v_lat, v_lng);
  new.approx_area := round(v_pin.pin_lat::numeric, 6)::text || ',' || round(v_pin.pin_lng::numeric, 6)::text;
  return new;
end;
$function$;
revoke execute on function private.sighting_area_to_pin() from public, anon, authenticated;

drop trigger if exists sighting_area_to_pin on public.sightings;
create trigger sighting_area_to_pin
  before insert or update of approx_area, user_a, user_b on public.sightings
  for each row execute function private.sighting_area_to_pin();

-- 4. Column allowlists (defence in depth) -----------------------------------------------------------------------------------
revoke select on public.stories from anon, authenticated;
grant select (id, user_id, media_path, media_type, created_at, expires_at, is_public, gathering_id, partner_id)
  on public.stories to anon, authenticated;

revoke select on public.sightings from anon, authenticated;
grant select (id, user_a, user_b, first_seen_at, last_seen_at, expires_at) on public.sightings to anon, authenticated;

-- 5. The map reads the stored pin ------------------------------------------------------------------------------------------
create or replace function public.get_public_stories_with_fuzzed_coords()
 returns table(id uuid, user_id uuid, media_path text, media_type text, created_at timestamp with time zone, expires_at timestamp with time zone, fuzzed_lat double precision, fuzzed_lng double precision)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- latitude/longitude already hold the pin (story_location_to_pin, item 148); the precise point is never stored.
  select s.id, s.user_id, s.media_path, s.media_type, s.created_at, s.expires_at, s.latitude, s.longitude
  from stories s
  where s.is_public = true
  and s.gathering_id is null
  and s.partner_id is null
  and s.expires_at > now()
  and s.latitude is not null
  and s.longitude is not null
  and not public.viewer_blocked_either_way(s.user_id);
$function$;

-- 6. The unused sighting pin function -------------------------------------------------------------------------------------
drop function if exists public.get_sighting_fuzzed_coords(uuid[]);

-- 7. Existing rows ---------------------------------------------------------------------------------------------------------
update public.stories set latitude = latitude where latitude is not null or longitude is not null or partner_id is not null;
update public.sightings set approx_area = approx_area where approx_area is not null;
