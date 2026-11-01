-- Rollback for migration 20270375 (account takeover protection + recovery). Run BEFORE rolling back 20270374 and earlier
-- (newest first). Turn deletion protection off and let no scheduled deletion be pending first (see the WARNINGS).
-- WARNING: deletes the private account security record, step-ups, recovery holds, the recovery audit and scheduled deletions.
--   Export first if they must be kept: select * from private.account_security_events; ... private.account_recovery_audit;
-- WARNING: a pending scheduled deletion or an open hold leaves that account banned after this (banned_until stays): resolve
--   them first (admin_recover_account / admin_release_recovery_hold), or clear banned_until for those accounts by hand.
-- After this, a phone-only account can again gain a password or email and a number change is allowed at any time.
select cron.unschedule(jobid) from cron.job where jobname in ('purge-account-security-events', 'expire-recovery-holds', 'request-due-deletions');
drop trigger if exists aa_account_takeover_guard on auth.users;
drop trigger if exists zz_account_phone_changed_notice on auth.users;
drop trigger if exists zz_account_new_sign_in on auth.sessions;
drop function if exists public.admin_get_account_recovery(uuid);
drop function if exists public.admin_get_account_security_events(uuid);
drop function if exists public.admin_recover_account(uuid, uuid, text[], text, uuid);
drop function if exists public.admin_release_recovery_hold(uuid, text);
drop function if exists public.admin_extend_recovery_hold(uuid, text);
drop function if exists public.admin_authorize_new_recovery_incident(uuid, uuid, text);
drop function if exists private.recovery_incident_ends(uuid);
drop function if exists public.admin_place_recovery_hold(uuid, uuid, text);
drop function if exists public.admin_open_account_recovery(uuid, text);
drop function if exists public.account_deletion_finished(uuid);
drop function if exists public.account_deletions_due();
drop function if exists public.account_deletion_authorize(uuid, uuid, text);
drop function if exists public.complete_account_step_up(uuid, uuid);
drop function if exists public.begin_account_step_up(text, text);
drop function if exists public.get_my_phone_change_wait();
drop function if exists private.purge_account_security_events();
drop function if exists private.request_due_deletions();
drop function if exists private.expire_recovery_holds();
drop function if exists private.reset_account_ban(uuid);
drop function if exists private.open_recovery_case(uuid, uuid);
drop function if exists private.recovery_text(text, integer);
drop function if exists private.require_recovery_admin();
drop function if exists private._auth_user_phone_changed_notice();
drop function if exists private._auth_session_created_notice();
drop function if exists private._auth_user_takeover_guard();
drop function if exists private.account_security_notice(uuid, text, text);
drop function if exists private.account_recovery_write_active();
drop function if exists private.account_ban_floor(uuid);
drop function if exists private.recovery_hold_active(uuid);
drop function if exists private.meets_second_factor(uuid, text);
drop function if exists private.session_established(uuid);
drop function if exists private.caller_session();
drop index if exists private.account_review_cases_one_open_recovery;
delete from private.account_review_case_events where case_id in (select id from private.account_review_cases where signal = 'account_recovery');
delete from private.account_review_cases where signal = 'account_recovery';
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension'));
alter table private.account_review_cases drop constraint if exists account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report', 'prior_suspension')) = (subject_user is not null));
drop table if exists private.account_recovery_audit;
drop function if exists private._account_recovery_audit_append_only();
drop table if exists private.account_recovery_admins;
drop table if exists private.account_recovery_marker;
drop table if exists private.account_step_ups;
drop table if exists private.account_deletion_requests;
drop table if exists private.account_recovery_holds;
drop table if exists private.account_recovery_incidents;
drop table if exists private.account_security_settings;
drop function if exists private.account_security_rule(text);
drop table if exists private.account_security_events;
