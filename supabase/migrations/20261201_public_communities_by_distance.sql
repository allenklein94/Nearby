-- Bounded, distance-ordered browse for public communities. getPublicCommunities() used to take the newest 200
-- active public communities and sort them by distance on the client, so a nearby OLDER community outside those
-- 200 could never surface. This returns the 200 (row_limit) NEAREST instead: communities with a coarse map point
-- (area_lat/area_lng) first, by real distance, then the rest newest-first to fill remaining slots.
-- SECURITY INVOKER (the default): communities' own SELECT policy still decides what's visible; the filter below
-- mirrors it (public + active) so ids can never include a community the client couldn't read. Returns ids and the
-- distance only -- the client fetches row data with a second bounded `.in('id', ...)`, same shape as gatherings.
create index if not exists communities_public_active_created_idx
  on public.communities (created_at desc) where is_public = true and status = 'active';

create or replace function public.get_public_community_ids_by_distance(
  my_lat double precision,
  my_lng double precision,
  row_limit integer default 200
)
returns table(id uuid, distance_miles double precision)
language sql
stable
set search_path to 'public'
as $function$
  select d.id, d.miles
  from (
    select c.id, c.created_at,
      case when c.area_lat is not null and c.area_lng is not null then
        3958.8 * acos(least(1.0, greatest(-1.0,
          cos(radians(my_lat)) * cos(radians(c.area_lat)) * cos(radians(c.area_lng) - radians(my_lng)) +
          sin(radians(my_lat)) * sin(radians(c.area_lat))
        )))
      end as miles
    from communities c
    where c.is_public = true and c.status = 'active'
  ) d
  order by d.miles asc nulls last, d.created_at desc
  limit least(greatest(coalesce(row_limit, 200), 1), 500);
$function$;
revoke all on function public.get_public_community_ids_by_distance(double precision, double precision, integer) from public, anon;
grant execute on function public.get_public_community_ids_by_distance(double precision, double precision, integer) to authenticated, service_role;
