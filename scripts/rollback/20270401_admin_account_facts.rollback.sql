-- Rollback of 20270401 (run before rolling back anything older). Drops the one read-only function; no data involved. The app
-- shows no Account facts section while the function is missing. Defect only; owner decides.
drop function if exists public.admin_get_account_facts(uuid);
