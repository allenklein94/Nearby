-- Rollback of 20270393 (admins remove reported gatherings + communities). Removed objects stay removed: the row is gone and the
-- chat with it. Each removal's who / when / why is written into its report's details first, so the record outlives the table; the
-- snapshots go, so copy private.content_removals out before running this if they are still needed. Defect only; owner decides.
-- The app: Remove Gathering / Remove Community stop showing (the status read fails quietly). Deploy order: nothing to do first.
select cron.unschedule('purge-content-removal-snapshots');
drop function if exists private.purge_content_removal_snapshots();

alter table public.reports disable trigger freeze_report_evidence;
update public.reports r
   set details = '[removed ' || c.content_type || ' ' || c.content_id::text || ' by ' || c.removed_by::text || ' at '
                 || to_char(c.removed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: ' || c.reason || ']' || coalesce(' ' || r.details, '')
  from private.content_removals c
 where c.report_id = r.id;
alter table public.reports enable trigger freeze_report_evidence;

drop trigger if exists aa_refuse_removed_series on public.gatherings;
drop function if exists private.refuse_removed_series();
drop function if exists public.admin_get_report_objects(uuid[]);
drop function if exists public.admin_remove_reported_content(uuid, text);
drop function if exists private.content_remove_community(public.communities, uuid, uuid, text);
drop function if exists private.content_remove_gathering(public.gatherings, uuid, uuid, text);
drop function if exists private.content_removal_close_links(text, uuid, boolean);

-- 20270116's function
create or replace function public.notify_gathering_cancelled()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  recipient record;
begin

  for recipient in
    select user_id from gathering_interest where gathering_id = old.id and status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = old.id
       and old.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = old.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = old.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      perform public._send_push(recipient.user_id, 'A gathering was cancelled', '"' || old.title || '" has been cancelled by the host.', jsonb_build_object('type', 'gathering_cancelled'));
    end if;
  end loop;
  return old;
end;
$function$;

drop table if exists private.content_removals;
