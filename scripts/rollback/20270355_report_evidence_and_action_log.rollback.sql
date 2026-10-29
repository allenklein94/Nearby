-- Rollback for migration 20270355 (I3 report evidence + action log). Run after 20270356's rollback.
-- WARNING: deletes the server copies of reported content and the whole report action log (who resolved what, outcomes,
-- notes). Export first if they must be kept:  select * from public.report_actions;  and the reports content_* columns.
-- Reports whose account was deleted while this was live keep a NULL reference (they can't be re-linked); the cascade
-- comes back for new deletions.
select cron.unschedule('purge-expired-reports') where exists (select 1 from cron.job where jobname = 'purge-expired-reports');
drop function if exists private.purge_expired_reports();
drop trigger if exists notify_admins_new_report on public.reports;
drop function if exists public._notify_admins_new_report();
alter table public.reports drop constraint if exists reports_reporter_id_fkey;
alter table public.reports add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete cascade;
alter table public.reports drop constraint if exists reports_reported_id_fkey;
alter table public.reports add constraint reports_reported_id_fkey
  foreign key (reported_id) references public.profiles(id) on delete cascade;
drop trigger if exists capture_report_content on public.reports;
drop trigger if exists freeze_report_evidence on public.reports;
drop trigger if exists log_report_resolution on public.reports;
drop function if exists public._capture_report_content();
drop function if exists public._freeze_report_evidence();
drop function if exists public._log_report_resolution();
drop function if exists public.admin_resolve_report(uuid, text, text);
drop table if exists public.report_actions;
alter table public.reports drop constraint if exists reports_content_pair_check;
alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports
  drop column if exists reported_deleted_at,
  drop column if exists reporter_deleted_at,
  drop column if exists content_captured_at,
  drop column if exists content_sent_at,
  drop column if exists content_excerpt,
  drop column if exists content_id,
  drop column if exists content_type;
