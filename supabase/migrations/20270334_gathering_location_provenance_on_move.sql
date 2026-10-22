-- Follow-up to 20270333 (owner 2026-10-22, Google storage fix): `authenticated` holds table-level UPDATE on gatherings, so
-- a host can still move the point with a direct write. A moved point is no longer the pin that was confirmed: relabel it
-- 'host_pin' and drop Google's place ID, so a stale 'google_confirmed' never describes a point it didn't produce
-- (same rule as brand_partners' trigger in 20270333). Nothing else changes.
create or replace function public._gathering_location_provenance_on_move()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if (new.precise_lat is distinct from old.precise_lat or new.precise_lng is distinct from old.precise_lng)
     and new.location_source is not distinct from old.location_source then
    new.location_source := 'host_pin';
    new.google_place_id := null;
  end if;
  return new;
end;
$function$;
revoke all on function public._gathering_location_provenance_on_move() from public, anon, authenticated;

drop trigger if exists gathering_location_provenance_on_move on public.gatherings;
create trigger gathering_location_provenance_on_move
  before update of precise_lat, precise_lng on public.gatherings
  for each row execute function public._gathering_location_provenance_on_move();
