-- Final trust & safety gap audit (owner, 2026-10-30): two server-only functions were executable by any signed-in account.
-- Staged after 20270363, separate from 0348-0363; deploy only with its own approval. No app or edge function calls either.
--   get_social_forecast(lat, lng)            unused since the baseline; each call makes the database fetch OpenWeather with
--                                            the vault key and polls up to 20 s (pg_sleep), holding a connection: a few dozen
--                                            parallel calls could exhaust the connection pool and burn the weather quota.
--   send_occasion_group_plan_stall_nudges()  the cron job (runs as postgres); any account could fire every stalled plan's
--                                            "Still deciding?" push early (once per plan).
-- Only EXECUTE for authenticated is removed; postgres (cron) and service_role keep it; the functions are unchanged.
revoke execute on function public.get_social_forecast(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.send_occasion_group_plan_stall_nudges() from public, anon, authenticated;
