-- Rollback for 20270371 (Verified Business). Newest first: run only after any later migration's rollback.
-- Removes the badge everywhere at once (the reader goes; the app treats a missing reader as "no badge") and DELETES the
-- verification history. Export it first if it must be kept:
--   select * from private.business_verification_events order by id;
-- Approval, businesses and everything else are untouched (nothing else references this record).
drop function if exists public.admin_business_verification_methods();
drop function if exists public.admin_list_business_verifications();
drop function if exists public.admin_revoke_business_verification(uuid, text);
drop function if exists public.admin_verify_business(uuid, jsonb, text);
drop function if exists public.get_verified_business_ids(uuid[]);
drop function if exists private.business_verification_status(uuid);
drop function if exists private.business_verification_clean_checks(jsonb);
drop function if exists private.business_verification_methods();
drop trigger if exists business_verification_event_guard on private.business_verification_events;
drop table if exists private.business_verification_events;
drop function if exists private._business_verification_event_guard();
