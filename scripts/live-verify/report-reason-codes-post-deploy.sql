-- 20270370 post-deploy check (READ-ONLY). Run right after the deploy.
-- Expected: not_codes 0, constraint_present true, trigger_present true, urgent_codes true, legacy_maps true, unknown_refused
-- true, clients_cannot_call true; reasons = the stored codes with counts (prod before deploy: 1 row, moderate-photo's,
-- now 'auto_photo_failed'). Any other result = STOP and report
-- (rollback: scripts/rollback/20270370_report_reason_codes.rollback.sql, run before rolling back 20270369).
select
  (select count(*) from public.reports where private.report_reason_code(reason) is distinct from reason) as not_codes,
  exists (select 1 from pg_constraint where conname = 'reports_reason_code_check' and conrelid = 'public.reports'::regclass) as constraint_present,
  exists (select 1 from pg_trigger where tgname = 'aa_normalize_report_reason' and tgrelid = 'public.reports'::regclass and tgenabled = 'O') as trigger_present,
  exists (select 1 from pg_trigger where tgname = 'freeze_report_evidence' and tgrelid = 'public.reports'::regclass and tgenabled = 'O') as freeze_enabled,
  (private.is_urgent_report_reason('harassment') and private.is_urgent_report_reason('underage_user')
     and private.is_urgent_report_reason('Underage user') and not private.is_urgent_report_reason('fake_profile')) as urgent_codes,
  (private.report_reason_code('Fake profile') = 'fake_profile' and private.report_reason_code('Spam or scam') = 'spam_scam') as legacy_maps,
  (private.report_reason_code('Acoso o abuso') is null and private.report_reason_code('anything') is null) as unknown_refused,
  (not has_function_privilege('authenticated', 'private.report_reason_code(text)', 'execute')
     and not has_function_privilege('anon', 'public._normalize_report_reason()', 'execute')) as clients_cannot_call,
  (select jsonb_object_agg(reason, n) from (select reason, count(*) n from public.reports group by 1) x) as reasons;
