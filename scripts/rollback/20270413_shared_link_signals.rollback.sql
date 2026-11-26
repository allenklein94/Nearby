-- Rollback for migration 20270413 (the same website in public gatherings on several accounts). Run BEFORE rolling back
-- 20270412 and earlier (newest first).
-- WARNING: deletes every link sighting key, every excluded destination key, the platform list, the secret (a later re-apply
-- makes a NEW secret: keys from before can never match again) and every shared-link review case with its history. Export
-- first if they must be kept:
--   select * from private.account_review_cases where signal = 'shared_link';
-- Gatherings themselves are untouched. Failures it logged stay in 20270378's private.text_signal_failures (step only).
select cron.unschedule(jobid) from cron.job where jobname = 'purge-link-sightings';
drop trigger if exists zz_gathering_link_sighting on public.gatherings;
drop function if exists private._gathering_link_sighting();
drop function if exists private.backfill_link_sightings();
drop function if exists private.purge_link_sightings();
drop function if exists private.note_link_sightings(uuid, uuid, text, text);
drop function if exists private.evaluate_shared_link(bytea);
drop function if exists private.exclude_shared_link(text);
drop function if exists private.shared_link_key(text);
drop function if exists private._shared_link_hmac(text);
drop function if exists private.shared_link_destination(text);
drop function if exists private.punycode_decode(text);
drop function if exists private.shared_link_active();
-- the review queue as 20270406 left it (events go with their cases: their guard allows that once the case is gone)
delete from private.account_review_cases where signal = 'shared_link';
drop table if exists private.account_review_case_link_keys;
drop table if exists private.link_sightings;
drop table if exists private.shared_link_excluded_keys;
drop table if exists private.shared_link_platforms;
drop table if exists private.link_signal_secret;
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'prior_unresolved', 'account_recovery', 'shared_device', 'shared_text'));
alter table private.account_signal_settings drop column if exists shared_link_min_accounts;
