-- Rollback for 20270387 (screening outage alerts). Monitoring only: nothing else depends on these objects. The screening
-- edge functions ignore a failed report (missing function = 404, swallowed), so they keep working unchanged after this.
-- Drops the failure log and outage history (no content, no user data in either).
drop function if exists public.record_screening_service_result(text, boolean, text, integer);
drop function if exists private._screening_outage_alert(bigint, text, text);
drop table if exists private.screening_outages;
drop table if exists private.screening_service_failures;
