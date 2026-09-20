-- Verifies get_gathering_approved_counts (migration 20270147). Run via the Management API; rolled back.
begin;
select set_config('request.jwt.claims', json_build_object('sub',(select id from profiles limit 1),'role','authenticated')::text, true);
with raw as (select gathering_id, count(*)::int c from gathering_interest where status='approved' group by 1),
fn as (select * from public.get_gathering_approved_counts(array(select id from gatherings)))
select (select count(*) from raw) raw_rows, (select count(*) from fn) fn_rows,
 (select count(*) from raw r join fn f using (gathering_id) where r.c = f.approved_count) matching;
rollback;
