-- Item 146 (owner, approved 2026-10-17): a gathering's precise point (precise_lat/lng) reaches only its host and approved
-- attendees, and only through get_gathering_meetup_point (unchanged). Scope + audit:
-- PRODUCT_AUDIT/ITEM_146_PRECISE_LOCATION_SECURITY_SCOPE_2026-10-17.md. Found live (rolled back) before this migration:
--   P1 a table-level SELECT grant to anon + authenticated (with the `Anyone can view gatherings` qual = true policy) let
--      anyone, signed out included, read the exact point of ANY gathering, invite-only too;
--   P2 get_gathering_distances' "fuzzed" pin = precise + an offset from md5(id), which anyone can compute and subtract,
--      and its distance_miles was measured to the precise point from any origin (trilateration);
--   P3 get_bounded_nearby_gathering_ids tested its radius on the precise point (a shrinking-radius oracle);
--   P4 count_gatherings_near(_batch) counted every future gathering of any visibility in a ~110 m box around any number of
--      caller-chosen points (a grid scan).
-- This migration:
--   1. Replaces the table-wide SELECT with a column list: every column EXCEPT precise_lat/precise_lng, for anon and
--      authenticated. INSERT/UPDATE are untouched (the host still writes the point; RLS keeps UPDATE to the host). The host's
--      own direct read of the point is refused too: the lookup is the one route (owner-approved).
--      FORWARD RULE: Postgres column grants never cover columns added later. A migration adding a gatherings column must
--      also `grant select (<column>) on public.gatherings to anon, authenticated` (guard: src/utils/gatheringPreciseLocationGuard.test.js;
--      live: scripts/live-verify/gathering-precise-location-access.sql).
--   2. Pins come from a server-only secret (private.pin_secret, no client grants, schema not exposed by the API) via
--      private.gathering_pin(): same per-axis bound as before (+/- 0.0035 deg, ~390 m), deterministic per gathering. Every
--      pin moves once (owner-approved).
--   3. get_gathering_distances measures distance_miles to the pin, never the precise point (shifts up to ~0.25 mi,
--      owner-approved). get_bounded_nearby_gathering_ids tests its radius on the pin.
--   4. count_gatherings_near_batch counts only public, discoverable gatherings (visibility 'everyone' + discoverable) and
--      takes at most 20 points (the client sends Google's max of 20). The uncalled count_gatherings_near is dropped.
-- Same signatures, one overload each; execute grants unchanged (authenticated only).
-- NOT in this item (owner D3, a separate high-priority item): gathering ROWS of every visibility stay readable by anon
-- (qual = true), so a non-public gathering's title, description, host and time are still exposed. Item 146 fixes the
-- coordinates only.

-- 1. Column allowlist ----------------------------------------------------------------------------------------------------
revoke select on public.gatherings from anon, authenticated;
grant select (
  id, host_id, title, description, interest_tag, area, scheduled_at, created_at, wide_area, is_public, show_on_map,
  reminder_sent, women_only, community_id, hosting_partner_id, recurrence_rule, recurring_series_id, series_stopped,
  energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps, cover_photo_path, visibility,
  capacity, ask_local_businesses, price_level, party_type, show_group_insights, requires_approval, host_notifications,
  allow_attendee_invites, discoverable, equipment_provided, duration_minutes, genre, features, suited_age_min,
  suited_age_max, format, skill_level, effort_level, submission_id, ticket_required
) on public.gatherings to anon, authenticated;

-- 2. Server-only pin secret ------------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.pin_secret (
  id boolean primary key default true check (id),
  secret bytea not null
);
revoke all on private.pin_secret from public, anon, authenticated;
insert into private.pin_secret (secret) values (extensions.gen_random_bytes(32)) on conflict (id) do nothing;

-- The public pin of a gathering: precise point + a keyed offset per axis in [-0.0035, +0.0035) degrees.
create or replace function private.gathering_pin(gathering_id uuid, lat double precision, lng double precision,
  out pin_lat double precision, out pin_lng double precision)
 language sql
 stable
 set search_path to 'private'
as $function$
  select lat + (((get_byte(h, 0) * 256 + get_byte(h, 1)) / 65536.0) - 0.5) * 0.007,
         lng + (((get_byte(h, 2) * 256 + get_byte(h, 3)) / 65536.0) - 0.5) * 0.007
  from (select extensions.hmac(convert_to(gathering_id::text, 'UTF8'), s.secret, 'sha256') h from private.pin_secret s) k;
$function$;
revoke execute on function private.gathering_pin(uuid, double precision, double precision) from public, anon, authenticated;

-- 3. Distances and radius on the pin ---------------------------------------------------------------------------------------
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
  cross join lateral private.gathering_pin(g.id, g.precise_lat, g.precise_lng) p
  where g.id = any(gathering_ids)
    and g.precise_lat is not null
    and g.precise_lng is not null;
$function$;

create or replace function public.get_bounded_nearby_gathering_ids(my_lat double precision, my_lng double precision, max_miles double precision, row_limit integer DEFAULT 500)
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
    and (
      g.is_public = true
      or (
        g.precise_lat is not null
        and g.precise_lng is not null
        -- Bounding-box pre-filter on the indexed precise columns, widened by the pin's 0.0035 deg bound so no pin inside
        -- the radius is cut; the exact test below runs on the pin, never the precise point.
        and g.precise_lat between my_lat - (max_miles / 69.0) - 0.0035 and my_lat + (max_miles / 69.0) + 0.0035
        and g.precise_lng between my_lng - (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01))) - 0.0035
                              and my_lng + (max_miles / (69.0 * greatest(cos(radians(my_lat)), 0.01))) + 0.0035
        and exists (
          select 1 from private.gathering_pin(g.id, g.precise_lat, g.precise_lng) p
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

-- 4. Place counts: public + discoverable only, at most 20 points ----------------------------------------------------------
create or replace function public.count_gatherings_near_batch(lats double precision[], lngs double precision[])
 returns table(idx integer, gathering_count integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(cardinality(lats), 0) > 20 or coalesce(cardinality(lngs), 0) > 20 then
    raise exception 'count_gatherings_near_batch: at most 20 points per call';
  end if;
  return query
  select
    q.idx::integer,
    (
      select count(*)::integer
      from gatherings g
      where g.scheduled_at >= now()
        and g.visibility = 'everyone'
        and g.discoverable = true
        and g.precise_lat between q.lat - 0.001 and q.lat + 0.001
        and g.precise_lng between q.lng - 0.001 and q.lng + 0.001
    ) as gathering_count
  from unnest(lats, lngs) with ordinality as q(lat, lng, idx);
end;
$function$;

drop function if exists public.count_gatherings_near(double precision, double precision);
