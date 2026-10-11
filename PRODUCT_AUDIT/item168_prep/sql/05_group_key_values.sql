-- Read-only scan: every text / text[] column in public tables (not views) that STORES one of the 19 group keys, with
-- per-key row counts. Uses query_to_xml so nothing is created.
with cols as (
  select c.table_name, c.column_name, c.data_type
  from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and (c.data_type in ('text','character varying') or c.udt_name = '_text')
), keys as (select unnest(category_major_keys()) as k)
select table_name, column_name, k as group_key,
  (xpath('/row/n/text()', query_to_xml(format(
     case when data_type = 'ARRAY' then 'select count(*) as n from public.%I where %L = any(%I)'
          else 'select count(*) as n from public.%I where %I = %L' end,
     table_name, case when data_type = 'ARRAY' then k else column_name end, case when data_type = 'ARRAY' then column_name else k end), false, true, '')))[1]::text::int as rows
from cols, keys
where table_name not like 'category\_%'
order by 1, 2, 3;
