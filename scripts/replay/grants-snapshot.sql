-- Grants snapshot (public + private, non-extension): function EXECUTE, table and column privileges for PUBLIC/anon/authenticated/service_role,
-- one sorted line each. Run on prod (Management API) and on a KEEP=1 replay (docker exec -i nearby-replay psql -U postgres -At), then diff.
with ext as (select objid from pg_depend where deptype='e')
select string_agg(line, E'\n' order by line collate "C") from (
 select 'F '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||coalesce(a.grantee::regrole::text,'PUBLIC')||' '||a.privilege_type as line
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where n.nspname in ('public','private') and p.oid not in (select objid from ext)
   and coalesce(a.grantee::regrole::text,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role')
 union all
 select 'T '||table_schema||'.'||table_name||' '||grantee||' '||privilege_type from information_schema.role_table_grants
 where table_schema in ('public','private') and grantee in ('PUBLIC','anon','authenticated','service_role')
 union all
 select 'C '||table_schema||'.'||table_name||'.'||column_name||' '||grantee||' '||privilege_type from information_schema.column_privileges c
 where table_schema in ('public','private') and grantee in ('anon','authenticated')
   and not exists (select 1 from information_schema.role_table_grants t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.grantee=c.grantee and t.privilege_type=c.privilege_type)
) x;
