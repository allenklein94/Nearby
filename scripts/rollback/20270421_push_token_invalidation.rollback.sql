-- Rollback for 20270421_push_token_invalidation.sql. Run in one transaction. Deploy the previous send-push FIRST (or
-- accept that its ticket bookkeeping fails quietly: the push itself never depends on it). Tokens already cleared stay
-- cleared (a reinstalled app registers again when opened); unsettled receipt rows are dropped with the table.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'check-push-receipts') then
    perform cron.unschedule('check-push-receipts');
  end if;
end;
$cron$;
drop function if exists public.dispatch_push_receipt_checks();
drop function if exists public._settle_push_receipt(text, text);
drop function if exists public._push_receipts_due(int);
drop function if exists public._invalidate_push_token(uuid, text);
drop function if exists private.invalidate_push_token(uuid, text);
drop function if exists public._record_push_ticket(text, uuid, text, text, text, jsonb);
drop table if exists private.push_receipt_checks;
drop function if exists private.push_token_sha256(text);
