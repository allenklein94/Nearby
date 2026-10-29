-- Rollback for migration 20270355 (I3 report evidence + action log). Run after 20270356's rollback.
-- WARNING: deletes the server copies of reported content and the whole report action log (who resolved what, outcomes,
-- notes). Export first if they must be kept:  select * from public.report_actions;  and the reports content_* columns.
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
  drop column if exists content_captured_at,
  drop column if exists content_sent_at,
  drop column if exists content_excerpt,
  drop column if exists content_id,
  drop column if exists content_type;
