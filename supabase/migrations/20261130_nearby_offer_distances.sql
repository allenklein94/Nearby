-- Same set as get_nearby_offer_ids (offers within radius of the caller) but also returns the real distance,
-- so the client can order offers nearest-first. A new function rather than a changed RETURNS TABLE on the
-- existing one (which would leave two overloads); get_nearby_offer_ids stays for any older client.
create or replace function public.get_nearby_offer_distances(my_lat double precision, my_lng double precision, radius_miles double precision default 50)
 returns table(id uuid, distance_miles double precision)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select d.id, d.miles
  from (
    select o.id,
      (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(my_lat)) * cos(radians(coalesce(o.latitude, p.latitude))) * cos(radians(coalesce(o.longitude, p.longitude)) - radians(my_lng)) +
          sin(radians(my_lat)) * sin(radians(coalesce(o.latitude, p.latitude)))
        ))
      )) as miles
    from brand_offers o
    join brand_partners p on p.id = o.partner_id
    where coalesce(o.latitude, p.latitude) is not null
      and coalesce(o.longitude, p.longitude) is not null
  ) d
  where d.miles <= radius_miles;
$function$;
revoke all on function public.get_nearby_offer_distances(double precision, double precision, double precision) from public, anon;
grant execute on function public.get_nearby_offer_distances(double precision, double precision, double precision) to authenticated, service_role;
