-- Follow-up to 20270141: PostgreSQL 17 added a MAINTAIN privilege (VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH/LOCK
-- TABLE), and Supabase's default grants hand it to anon on every public table too. Revoke it, and stop new
-- tables inheriting it. Guarded by server version: the from-scratch replay image (supabase/postgres 15.x) has no
-- MAINTAIN keyword, so on <17 this migration is a no-op.

do $$
declare r record;
begin
  if current_setting('server_version_num')::int >= 170000 then
    for r in
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    loop
      execute format('revoke maintain on public.%I from anon', r.relname);
    end loop;
    execute 'alter default privileges in schema public revoke maintain on tables from anon';
  end if;
end $$;
