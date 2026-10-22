-- Owner decision 2026-10-22 (Google compliance): Nearby's Google-backed DISCOVERY surfaces (Discover's Places tab and Places
-- sections, Discover's topic places, Places to go, Create's "Popular nearby", "Also nearby (not a Nearby partner)") stay
-- built but are not shown to anyone until Google Maps Platform or qualified counsel answers, in writing, whether they are a
-- "listings or directory service" under Google Maps Platform ToS 3.2.3(d)(iii)
-- (PRODUCT_AUDIT/GOOGLE_DIRECTORY_USE_QUESTION_2026-10-22.md).
--   - ONE switch, places_search_budget.discovery_enabled, default OFF; the owner turns it on with SQL (service role), only
--     after that written answer. Read by the app through places_discovery_enabled() (utils/googleDiscovery.js).
--   - "Also nearby" keeps its own switch and now ALSO needs this one (both must be on).
--   - Not held: address search on the pin screens ('geocode') and the business sign-up lookup (not discovery); the daily
--     budget (claim_places_search) is unchanged.

alter table public.places_search_budget add column if not exists discovery_enabled boolean not null default false;

create or replace function public.places_discovery_enabled()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null and coalesce((select discovery_enabled from places_search_budget where id = 1), false);
$function$;

revoke all on function public.places_discovery_enabled() from public, anon;
grant execute on function public.places_discovery_enabled() to authenticated;

create or replace function public.places_also_nearby_enabled()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null
     and coalesce((select also_nearby_enabled and discovery_enabled from places_search_budget where id = 1), false);
$function$;

revoke all on function public.places_also_nearby_enabled() from public, anon;
grant execute on function public.places_also_nearby_enabled() to authenticated;
