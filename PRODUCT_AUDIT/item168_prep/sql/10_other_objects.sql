-- Views / materialized views, RLS policies, triggers and cron jobs that touch the taxonomy, plus the sponsorable group
-- list and the gathering format CHECK (for the new `league` format value).
select 'view' as kind, c.relname as name, left(pg_get_viewdef(c.oid), 300) as detail
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v','m')
  and pg_get_viewdef(c.oid) ~* '(category_tag_groups|group_key|interest_tag|subcategory|categor)'
union all
select 'policy', tablename||'.'||policyname, left(coalesce(qual,'')||' '||coalesce(with_check,''), 300) from pg_policies
 where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ~* '(category_tag_groups|group_key|business_only|_recreation|stay_getaway|travel_experiences)'
union all
select 'trigger', tgrelid::regclass::text||'.'||tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where not tgisinternal and (p.prosrc ~* '(category_tag_groups|subcategory|interest_tag|categories)' )
union all
select 'cron', jobname, left(command, 300) from cron.job where command ~* '(categor|taxonom|trend|interest)'
union all
select 'sponsorable_group', group_key, added_at::text from sponsorable_category_groups
union all
select 'format_check', conrelid::regclass::text||'.'||conname, pg_get_constraintdef(oid) from pg_constraint
 where contype='c' and connamespace='public'::regnamespace and pg_get_constraintdef(oid) ~ '''tournament''';
