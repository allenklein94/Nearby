-- Revoke anonymous WRITE-class privileges across the public schema.
--
-- Supabase's default grants give `anon` every table privilege on every public table. RLS was the only thing
-- stopping anonymous writes, and TRUNCATE (plus REFERENCES/TRIGGER) is not governed by RLS at all. The sweep
-- (2026-09-20) found 84 tables in that state. This removes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER from anon on every public table/partitioned table.
--
-- Deliberate exceptions and non-changes:
--  * business_acquisition_events keeps anon INSERT: docs/business.html (a public landing page, no login) logs
--    funnel events with the anon key, and its RLS policy admits (auth.uid() IS NULL AND user_id IS NULL).
--    Every other privilege on it is still revoked from anon.
--  * anon keeps SELECT everywhere: other tables' policies (chat, feedback, offers, stories, storage) subquery
--    these tables, and removing SELECT would turn an empty result into "permission denied". RLS still governs
--    what anon can read. SECURITY DEFINER RPCs (the public invite/night/tracking pages) run as owner and are
--    unaffected. `authenticated` privileges are untouched.
--  * Future tables: the migration role's default privileges no longer hand anon write-class privileges, so a
--    new table is closed by default. A table that genuinely needs anonymous writes must grant them explicitly.

do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', r.relname);
  end loop;
end $$;

grant insert on public.business_acquisition_events to anon;

alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
