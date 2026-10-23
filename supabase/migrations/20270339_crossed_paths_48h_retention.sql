-- Crossed Paths retention (owner decision 2026-10-23): the Privacy Policy promises a "crossed paths" record is deleted 48 hours
-- after two people were last near each other; until now nothing deleted it (purge_expired_sightings() was never scheduled, see
-- 20270323) and the app's Crossed Paths reads ignored expires_at, so a crossing stayed visible and stored forever.
--   - expires_at = last crossing + 48 h (the live `report-presence` edge function sets it on every upsert; unchanged).
--   - Read: the sightings SELECT policy now also needs expires_at > now(), so an expired crossing is never shown (Dating and
--     Friends Crossed Paths, Activity's crossed rows) even between purge runs. Owner + block rules unchanged.
--   - Delete: purge_expired_sightings() now deletes only expired sightings (presence has its own job, 20270323) and runs every
--     10 minutes. No table references sightings (no cascade); matches, waves, notices and shared-gathering Crossed Paths are
--     separate and untouched.
--   - Effect (owner to know): two people who cross again AFTER their record expired get a new record, so the INSERT trigger
--     notify_sighting_crossed_paths sends "You crossed paths!" again (before, the never-deleted row was only updated: one push per
--     pair, ever). Crossings within 48 h still update the same row (no new push).

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

select cron.unschedule(jobid) from cron.job where jobname = 'purge-expired-sightings';
select cron.schedule('purge-expired-sightings', '*/10 * * * *', 'select public.purge_expired_sightings();');
