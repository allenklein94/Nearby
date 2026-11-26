-- Rollback of 20270397 (reporter feedback loop). Reporters' "Report received" / "Review completed" statuses go with their table;
-- the reports, their evidence copies, outcomes and the admin workflow are untouched. Defect only; owner decides.
drop function if exists public.get_my_report_updates();
drop trigger if exists report_status_completed on public.reports;
drop trigger if exists report_status_received on public.reports;
drop function if exists private._report_status_completed();
drop function if exists private._report_status_received();
drop table if exists private.report_reporter_status;
