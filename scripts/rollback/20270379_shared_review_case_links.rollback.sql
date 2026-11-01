-- Rollback for migration 20270379 (shared review cases, read-only admin view). Run BEFORE rolling back 20270378 and earlier
-- (newest first). Drops the one read-only function; no data is stored by 20270379, so nothing else changes.
drop function if exists public.admin_get_shared_review_cases(uuid);
