-- Rollback for migration 20270375 (account takeover protection). Run BEFORE rolling back 20270374 and earlier (newest first).
-- WARNING: deletes the private account security record. Export first if it must be kept:
--   select * from private.account_security_events;
-- After this, a phone-only account can again gain a password or email and a number change is allowed at any time.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-account-security-events';
drop trigger if exists aa_account_takeover_guard on auth.users;
drop trigger if exists zz_account_phone_changed_notice on auth.users;
drop trigger if exists zz_account_new_sign_in on auth.sessions;
drop function if exists public.admin_get_account_security_events(uuid);
drop function if exists public.get_my_phone_change_wait();
drop function if exists private.purge_account_security_events();
drop function if exists private._auth_user_phone_changed_notice();
drop function if exists private._auth_session_created_notice();
drop function if exists private.account_security_notice(uuid, text);
drop function if exists private._auth_user_takeover_guard();
drop function if exists private.phone_change_allowed_at(timestamptz);
drop table if exists private.account_security_events;
