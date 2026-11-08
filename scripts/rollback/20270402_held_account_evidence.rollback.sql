-- Rollback of 20270402. WARNING: this deletes any evidence already preserved in private.held_account_evidence and the protection
-- stops. If the table holds rows, export them first and get the owner's + counsel's decision: they may be under an active hold.
-- Redeploy the earlier delete-account after this (it calls a function this removes; it tolerates that, but keep them matched).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-held-account-evidence') then
    perform cron.unschedule('purge-held-account-evidence');
  end if;
end;
$$;
-- 20270395's report rule + 20270374's purge, as they were
create or replace function private.report_on_legal_hold(p_report uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'private', 'public'
as $function$
  select exists (select 1 from private.legal_holds h
                  where h.released_at is null
                    and ((h.target_type = 'report' and h.target_id = p_report)
                      or (h.target_type = 'content_removal'
                          and h.target_id in (select c.id from private.content_removals c where c.report_id = p_report))));
$function$;
create or replace function private.purge_suspended_account_records()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.suspended_account_records where expires_at <= now();
  -- anything the matcher could not take within a day (it runs every 10 minutes): dropped, never kept
  delete from private.phone_match_queue where queued_at < now() - interval '1 day';
  delete from private.suspended_number_failures where at < now() - interval '90 days';
$function$;
drop trigger if exists a_preserve_held_evidence on public.profiles;
drop trigger if exists a_preserve_held_evidence on auth.users;
drop function if exists public.account_deletion_preserve_held_evidence(uuid);
drop function if exists private.purge_held_account_evidence();
drop function if exists private._preserve_held_evidence_before_delete();
drop function if exists private.preserve_held_account_evidence(uuid);
drop trigger if exists held_evidence_guard on private.held_account_evidence;
drop function if exists private._held_evidence_guard();
drop function if exists private.held_evidence_hold_purgeable(uuid);
drop function if exists private.held_evidence_retention();
drop table if exists private.held_account_evidence;
