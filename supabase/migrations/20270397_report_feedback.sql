-- Reporter feedback loop (owner, 2026-11-07; post-Tier 1, staged after 20270396).
-- The person who filed a report sees two private statuses in Activity, and nothing else:
--   "Report received"  : the report was saved (any report type: profile, gathering, community, business, offer, message, media)
--   "Review completed" : an admin resolved it, the FIRST time it was ever resolved
-- Never the outcome (no_action / action_taken), the note, the reported account, the evidence copy or any action on anyone.
--
-- One private row per report (`private.report_reporter_status`, no client access), created when the report is saved and
-- marked completed by the ONE resolve path (`reports.resolved` false -> true: admin_resolve_report or the old direct update).
-- completed_at is set once (`where completed_at is null`): a retry of admin_resolve_report changes nothing (it returns
-- {already} before updating), a reopen leaves it as is, and a second resolve after a reopen finds it already set. So the
-- reporter gets exactly one completion, ever. No push: an Activity row only (owner).
-- Read only through `get_my_report_updates()` (definer, the caller's own rows, newest 20). The row goes with the report (12-month
-- purge, cascade) and with the reporter's account (cascade). Automated reports (moderate-photo's 'auto_%' codes) and reports
-- with no reporter get no row.
-- Rollback: scripts/rollback/20270397_report_feedback.rollback.sql

create table private.report_reporter_status (
  report_id uuid primary key references public.reports(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  received_at timestamptz not null default now(),
  completed_at timestamptz
);
create index report_reporter_status_reporter_idx on private.report_reporter_status (reporter_id);
revoke all on private.report_reporter_status from public, anon, authenticated, service_role;

create function private._report_status_received()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.reporter_id is not null and coalesce(new.reason, '') not like 'auto\_%' then
    insert into private.report_reporter_status (report_id, reporter_id, received_at, completed_at)
    values (new.id, new.reporter_id, coalesce(new.created_at, now()),
            case when coalesce(new.resolved, false) then now() end)
    on conflict (report_id) do nothing;
  end if;
  return null;
end;
$function$;
revoke all on function private._report_status_received() from public, anon, authenticated;

create trigger report_status_received after insert on public.reports
  for each row execute function private._report_status_received();

create function private._report_status_completed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(new.resolved, false) and not coalesce(old.resolved, false) then
    update private.report_reporter_status set completed_at = now()
     where report_id = new.id and completed_at is null;
  end if;
  return null;
end;
$function$;
revoke all on function private._report_status_completed() from public, anon, authenticated;

create trigger report_status_completed after update of resolved on public.reports
  for each row execute function private._report_status_completed();

-- Existing reports: received at their own time; a resolved one completed at its first resolve (else its filing time).
insert into private.report_reporter_status (report_id, reporter_id, received_at, completed_at)
select r.id, r.reporter_id, coalesce(r.created_at, now()),
       case when coalesce(r.resolved, false) then
         coalesce((select min(a.created_at) from public.report_actions a where a.report_id = r.id and a.action <> 'reopened'),
                  r.created_at, now()) end
  from public.reports r
 where r.reporter_id is not null and coalesce(r.reason, '') not like 'auto\_%'
on conflict (report_id) do nothing;

-- The reporter's own statuses: ids + times only.
create function public.get_my_report_updates()
returns table (report_id uuid, received_at timestamptz, completed_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.report_id, s.received_at, s.completed_at
    from private.report_reporter_status s
   where auth.uid() is not null and s.reporter_id = auth.uid()
   order by coalesce(s.completed_at, s.received_at) desc
   limit 20;
$function$;
revoke all on function public.get_my_report_updates() from public, anon;
grant execute on function public.get_my_report_updates() to authenticated;
