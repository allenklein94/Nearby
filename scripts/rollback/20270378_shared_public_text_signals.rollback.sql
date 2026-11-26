-- Rollback for migration 20270378 (the same public text on several accounts). Run BEFORE rolling back 20270377 and
-- earlier (newest first).
-- WARNING: deletes every text sighting key, every excluded template key, the secret (a later re-apply makes a NEW secret:
-- keys from before can never match again) and every shared-text review case with its history. Export first if they must
-- be kept:
--   select * from private.account_review_cases where signal = 'shared_text';
-- Bios and gathering descriptions themselves are untouched.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-text-sightings';
drop trigger if exists zz_profile_bio_sighting on public.profiles;
drop trigger if exists zz_gathering_description_sighting on public.gatherings;
drop function if exists private._profile_bio_sighting();
drop function if exists private._gathering_description_sighting();
drop function if exists private.backfill_shared_text_sightings();
drop function if exists private.purge_text_sightings();
drop function if exists private.note_text_sighting(uuid, text, uuid, text);
drop function if exists private.evaluate_shared_text(bytea);
drop function if exists private.exclude_shared_text(text);
drop function if exists private.shared_text_active();
drop function if exists private.shared_text_key(text);
drop function if exists private.shared_text_normalized(text);
-- the review queue as 20270377 left it (events go with their cases: their guard allows that once the case is gone)
delete from private.account_review_cases where signal = 'shared_text';
drop table if exists private.account_review_case_texts;
drop table if exists private.text_sightings;
drop table if exists private.shared_text_excluded_keys;
drop table if exists private.text_signal_failures;
drop table if exists private.text_signal_secret;
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'account_recovery', 'shared_device'));
alter table private.account_signal_settings drop column if exists shared_text_min_accounts;
alter table private.account_signal_settings drop column if exists shared_text_min_chars;
alter table private.account_signal_settings drop column if exists shared_text_min_words;
