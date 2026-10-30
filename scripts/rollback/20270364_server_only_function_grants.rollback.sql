-- Rollback for migration 20270364: restores the earlier (too wide) EXECUTE grants. Run before rolling back 20270363.
grant execute on function public.get_social_forecast(double precision, double precision) to authenticated;
grant execute on function public.send_occasion_group_plan_stall_nudges() to authenticated;
