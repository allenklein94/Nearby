-- Rollback for migration 20270374 (suspended-number retention). Run BEFORE rolling back 20270373 and earlier (newest first).
-- WARNING: deletes every retained suspended-account record (the number keys and the copied decisions), the match queue,
-- the secret (a later re-apply makes a NEW secret: keys from before can never match again) and every prior-suspension
-- review case with its history. Export first if they must be kept:
--   select * from private.suspended_account_records;
--   select * from private.account_review_cases where signal = 'prior_suspension';
select cron.unschedule(jobid) from cron.job where jobname in ('match-suspended-numbers', 'purge-suspended-account-records');
drop trigger if exists zz_retain_suspended_account on auth.users;
drop trigger if exists zz_queue_phone_match on auth.users;
drop function if exists public.admin_get_prior_suspension(uuid);
drop function if exists private.match_suspended_numbers();
drop function if exists private.purge_suspended_account_records();
drop function if exists private._auth_user_deleted_retain();
drop function if exists private._auth_user_phone_changed();
drop function if exists private.retain_suspended_account(uuid, text, boolean, text);
drop trigger if exists suspended_record_guard on private.suspended_account_records;
drop function if exists private._suspended_record_guard();
drop table if exists private.suspended_account_records;
drop table if exists private.phone_match_queue;
drop table if exists private.suspended_number_failures;
drop function if exists private.phone_number_key(text);
drop table if exists private.phone_match_secret;
-- the review queue as 20270369 left it (events go with their cases: their guard allows that once the case is gone)
delete from private.account_review_cases where signal = 'prior_suspension';
drop index if exists private.account_review_cases_one_prior_suspension;
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report')) = (subject_user is not null));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile'));
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report'));
