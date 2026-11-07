-- Rollback of 20270395 (legal holds). The holds go with their table: copy private.legal_holds out first if the record is needed.
-- From the next nightly run, evidence that was on hold is purged on the ordinary 12-month rules again, and a photo kept only by a
-- hold stays held until its report's next outcome (nothing is released by this rollback). Defect only; owner decides.
drop function if exists public.admin_list_legal_holds(boolean);
drop function if exists public.admin_release_legal_hold(uuid, text);
drop function if exists public.admin_place_legal_hold(text, uuid, text, text);

-- 20270355's function
create or replace function private.purge_expired_reports()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from reports r
   where coalesce(r.resolved, false)
     and coalesce((select max(a.created_at) from report_actions a where a.report_id = r.id and a.action <> 'reopened'),
                  r.created_at) < now() - interval '12 months';
$function$;
revoke all on function private.purge_expired_reports() from public, anon, authenticated;

-- 20270393's function
create or replace function private.purge_content_removal_snapshots()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update private.content_removals set snapshot = null
   where snapshot is not null and removed_at < now() - interval '12 months';
$function$;
revoke all on function private.purge_content_removal_snapshots() from public, anon, authenticated;

-- 20270369's function
create or replace function private.purge_account_review_cases()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  -- resolved: 12 months after the last close (or the last new evidence, if later)
  delete from private.account_review_cases c
   where c.status = 'closed'
     and greatest(c.closed_at, coalesce(c.new_evidence_at, c.closed_at)) < now() - interval '12 months';
  -- any case whose accounts have all been deleted
  delete from private.account_review_cases c
   where not exists (select 1 from private.account_review_case_members m where m.case_id = c.id)
     and c.opened_at < now() - interval '1 hour';
$function$;
revoke all on function private.purge_account_review_cases() from public, anon, authenticated;

-- 20270391's function
create or replace function private._report_media_follow_outcome()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.action = 'resolved_no_action' then
    update private.report_media_evidence set released_at = now() where report_id = new.report_id and released_at is null;
  elsif new.action = 'reopened' then
    -- waits for a run that has this file locked; a run that comes after sees the hold when it re-checks
    perform 1 from private.story_file_cleanup q
      where q.media_path in (select e.media_path from private.report_media_evidence e where e.report_id = new.report_id)
      for update of q;
    update private.report_media_evidence set released_at = null where report_id = new.report_id;
  end if;
  return null;
end;
$function$;
revoke all on function private._report_media_follow_outcome() from public, anon, authenticated;

drop function if exists private.case_on_legal_hold(uuid);
drop function if exists private.removal_on_legal_hold(uuid);
drop function if exists private.report_on_legal_hold(uuid);
drop function if exists private.legal_hold_lock();
drop table if exists private.legal_holds;
drop function if exists private.legal_hold_immutable();
