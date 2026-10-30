-- 20270364 post-deploy check (READ-ONLY). Run right after the deploy, and again after the next 12:00 UTC cron run.
-- Expected: every *_client column false, *_service true, cron_job_active true; after 12:00 UTC the latest run of job
-- 'send-occasion-group-plan-stall-nudges' has status 'succeeded' with start_time after the deploy (the job still works
-- as postgres). Any other result = STOP and report (rollback: scripts/rollback/20270364_server_only_function_grants.rollback.sql).
select
  has_function_privilege('authenticated', 'public.get_social_forecast(double precision, double precision)', 'execute') as forecast_client,
  has_function_privilege('anon', 'public.get_social_forecast(double precision, double precision)', 'execute') as forecast_anon_client,
  has_function_privilege('authenticated', 'public.send_occasion_group_plan_stall_nudges()', 'execute') as nudges_client,
  has_function_privilege('anon', 'public.send_occasion_group_plan_stall_nudges()', 'execute') as nudges_anon_client,
  has_function_privilege('service_role', 'public.get_social_forecast(double precision, double precision)', 'execute') as forecast_service,
  has_function_privilege('service_role', 'public.send_occasion_group_plan_stall_nudges()', 'execute') as nudges_service,
  (select active from cron.job where jobname = 'send-occasion-group-plan-stall-nudges' and username = 'postgres') as cron_job_active,
  (select jsonb_build_object('status', r.status, 'start_time', r.start_time, 'message', left(r.return_message, 200))
     from cron.job_run_details r join cron.job j on j.jobid = r.jobid
    where j.jobname = 'send-occasion-group-plan-stall-nudges'
    order by r.start_time desc limit 1) as latest_cron_run;
