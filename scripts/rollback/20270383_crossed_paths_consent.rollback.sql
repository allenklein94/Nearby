-- Rollback for migration 20270383 (crossed paths only between people who both chose it). Restores the read policy and the
-- purge exactly as after 20270339. Rows deleted by the migration's purge are not restored (they expire within 48 h anyway).
drop policy if exists "Users can view their own sightings only" on public.sightings;
create policy "Users can view their own sightings only" on public.sightings
  for select
  using (((auth.uid() = user_a) or (auth.uid() = user_b)) and (not is_blocked(user_a, user_b)) and expires_at > now());

create or replace function public.purge_expired_sightings()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from sightings where expires_at <= now();
$function$;
revoke execute on function public.purge_expired_sightings() from public, anon, authenticated;

drop trigger if exists aa_sighting_consent_guard on public.sightings;
drop function if exists private.sighting_consent_guard();
drop function if exists public.sighting_pair_visible(uuid, uuid);
drop function if exists private.crossed_paths_pair_allowed(uuid, uuid);
