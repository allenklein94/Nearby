-- Read-only scan: every text / text[] column in public base tables (except the category_* registry tables) that STORES
-- a canonical tag name (live tags), with per-tag row counts. Nothing is created (query_to_xml).
with cols as (
  select c.table_name, c.column_name, c.data_type
  from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and (c.data_type in ('text','character varying') or c.udt_name = '_text')
    and c.table_name not like 'category\_%'
), hits as (
  select table_name, column_name, data_type,
    query_to_xml(format(
      case when data_type = 'ARRAY'
        then 'select t as tag, count(*) as n from public.%1$I, unnest(%2$I) t where t in (select tag from category_tag_groups) group by t'
        else 'select %2$I as tag, count(*) as n from public.%1$I where %2$I in (select tag from category_tag_groups) group by %2$I' end,
      table_name, column_name), false, true, '') as x
  from cols
)
select table_name, column_name,
  (xpath('/row/tag/text()', r))[1]::text as tag, (xpath('/row/n/text()', r))[1]::text::int as rows
from hits, unnest(xpath('/table/row', ('<table>'||x::text||'</table>')::xml)) r
order by 1, 2, 3;
