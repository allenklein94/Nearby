-- Live verification for 20270144 (Management API). Expected: 10 rows matching the migration's column lists,
-- tablewide = 0, anon_sel = false. Read-only.
select c.relname, string_agg(a.attname, ',' order by a.attname) cols
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace,
 lateral aclexplode(a.attacl) x
where n.nspname='public' and a.attacl is not null and x.privilege_type='UPDATE'
 and x.grantee=(select oid from pg_roles where rolname='authenticated')
group by 1 order by 1;
-- select has_table_privilege('anon','public.live_tracking_sessions','SELECT');  -- false
