-- Presence retention (owner approved scheduling the existing cleanup, 2026-10-17, after inspection): presence_reports keeps
-- each person's last ~11 m area (one row per person, upserted by the live `report-presence` edge function) forever, because
-- purge_expired_sightings() was never scheduled. Clients cannot read the table; this is retention, not a read leak.
-- Inspected before scheduling: every reader of presence_reports uses only the last hour or less
--   - push_target_areas (view) -> notify_gathering_interest_threshold, _on_gathering_created: `reported_at > now() - 1 hour`
--   - report-presence: other people's reports in the last 10 min; the person's own previous report for the speed check
--     (after an hour away the speed check is skipped instead of allowing 700+ miles; no practical difference)
--   - services/confidenceMode.js reads it as the client and gets nothing (no client grant; unchanged)
-- so deleting reports older than 1 hour (purge_expired_sightings' own rule) changes no push, list or count.
-- NOT scheduled here: the sightings half of purge_expired_sightings(). The app's Crossed Paths reads (proximity.js,
-- friendDiscovery.js) do not filter on expires_at, so deleting expired sightings would make people leave Crossed Paths
-- 48 h after two people were last near each other (today they stay forever). That visible change waits for the owner.
create or replace function public.purge_stale_presence_reports()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from presence_reports where reported_at < now() - interval '1 hour';
$function$;
revoke execute on function public.purge_stale_presence_reports() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-stale-presence-reports';
select cron.schedule('purge-stale-presence-reports', '*/10 * * * *', 'select public.purge_stale_presence_reports();');
