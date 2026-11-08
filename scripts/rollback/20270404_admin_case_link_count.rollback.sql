-- Rollback of 20270404 (run before rolling back anything older). Drops the one read-only function; no data involved. The case view
-- shows no link count while the function is missing. Defect only; owner decides.
drop function if exists public.admin_get_case_link_count(uuid);
