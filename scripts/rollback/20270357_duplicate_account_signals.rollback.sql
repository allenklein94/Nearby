-- Rollback for migration 20270357 (I1 duplicate account signals). Run the rollbacks newest first (20270357 -> 20270355).
-- WARNING: deletes every photo fingerprint and every account review case (open and closed) with its admin note. Export
-- them first if the review history must be kept:  select * from private.account_review_cases;
drop trigger if exists fingerprint_main_photo on public.profiles;
drop trigger if exists fingerprint_extra_photo on public.profile_photos;
drop function if exists public._fingerprint_main_photo();
drop function if exists public._fingerprint_extra_photo();
drop function if exists public.admin_list_account_review_cases(boolean);
drop function if exists public.admin_close_account_review_case(uuid, text, text);
drop function if exists private.record_photo_fingerprint(uuid, text, text);
drop function if exists private.evaluate_photo_fingerprint(text);
drop function if exists private.normalized_name(text);
drop table if exists private.account_review_case_members;
drop table if exists private.account_review_cases;
drop table if exists private.account_signal_settings;
drop table if exists private.photo_fingerprints;
