-- Rollback for migration 20270376 (shared device notification token signals). Run BEFORE rolling back 20270375 and
-- earlier (newest first).
-- WARNING: deletes every device sighting key, every kept suspended-account device key, the secret (a later re-apply makes
-- a NEW secret: keys from before can never match again) and every shared-device review case with its history. Export
-- first if they must be kept:
--   select * from private.account_review_cases where signal = 'shared_device';
-- Push tokens themselves (private.push_tokens, 20270347) and push delivery are untouched.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-device-sightings';
drop trigger if exists zz_push_token_sighting on private.push_tokens;
drop trigger if exists zz_suspension_device_check on public.profiles;
drop trigger if exists zz_keep_suspended_device_keys on auth.users;
drop trigger if exists zz_review_member_device_recheck on private.account_review_case_members;
drop trigger if exists zz_review_case_device_recheck on private.account_review_cases;
drop function if exists private._review_case_device_recheck();
drop function if exists private._push_token_sighting();
drop function if exists private._suspension_device_check();
drop function if exists private._auth_user_deleted_keep_device_keys();
drop function if exists private.backfill_device_sightings();
drop function if exists private.purge_device_sightings();
drop function if exists private.note_device_sighting(uuid, text);
drop function if exists private.evaluate_shared_device(bytea);
drop function if exists private.shared_device_corroboration(uuid[]);
drop function if exists private.shared_device_active();
drop function if exists private.device_token_key(text);
-- the review queue as 20270375 left it (events go with their cases: their guard allows that once the case is gone)
delete from private.account_review_cases where signal = 'shared_device';
drop table if exists private.account_review_case_devices;
drop table if exists private.device_sightings;
drop table if exists private.suspended_device_keys;
drop table if exists private.device_signal_failures;
drop table if exists private.device_signal_secret;
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'account_recovery'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused',
                    'recovery_request'));
alter table private.account_signal_settings drop column if exists shared_device_min_accounts;
alter table private.account_signal_settings drop column if exists shared_device_suspended_enabled;
