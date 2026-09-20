-- Revoke TRUNCATE and MAINTAIN from `authenticated` on every public table.
--
-- Supabase's default grants give signed-in users every table privilege. TRUNCATE is not governed by RLS at all
-- (the REST API does not expose it, but a direct database connection with the signed-in role would), and
-- MAINTAIN (PostgreSQL 17: VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH MATERIALIZED VIEW/LOCK TABLE) lets a signed-in
-- role take table-level locks. Nothing in the app needs either: no client or edge code issues them, and the
-- only public function mentioning one of those words is SECURITY DEFINER (runs as its owner).
--
-- Unchanged on purpose: authenticated keeps SELECT/INSERT/UPDATE/DELETE (RLS governs them), and REFERENCES/TRIGGER
-- (not asked for). service_role, postgres and SECURITY DEFINER functions are unaffected. New tables no longer
-- inherit these two privileges for authenticated either. MAINTAIN is guarded by server version (the replay image
-- is PostgreSQL 15, which has no such keyword).

do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate on public.%I from authenticated', r.relname);
    if current_setting('server_version_num')::int >= 170000 then
      execute format('revoke maintain on public.%I from authenticated', r.relname);
    end if;
  end loop;

  alter default privileges in schema public revoke truncate on tables from authenticated;
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from authenticated';
  end if;
end $$;
