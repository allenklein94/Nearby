-- The create-business-payment-intent edge function (service role) builds the Stripe description from
-- business_safe_request_summary() instead of the consumer's raw_text. Grant that explicitly rather than relying on the
-- project's default privileges; clients (anon/authenticated) still cannot call it.
grant execute on function public.business_safe_request_summary(uuid) to service_role;
