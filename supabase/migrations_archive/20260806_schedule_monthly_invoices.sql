-- Schedules generate_monthly_invoices() to actually run.
--
-- Without this, the function added in 20260806_partner_contracts_billing.sql
-- exists but nothing ever calls it. Runs at 06:00 UTC on the 1st of each
-- month, which is after the prior month has fully closed; the function
-- defaults to billing that just-closed month when called with no args.

select cron.schedule(
  'generate-monthly-invoices',
  '0 6 1 * *',
  $$select generate_monthly_invoices();$$
);
