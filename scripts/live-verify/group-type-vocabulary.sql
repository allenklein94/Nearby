-- Verifies migration 20270197. Rolled back: host can declare a coworkers gathering; an unknown type is refused.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_g uuid; v_host uuid; v_val text;
begin
  select id, host_id into v_g, v_host from gatherings limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update gatherings set party_type = 'coworkers' where id = v_g;
  select party_type into v_val from gatherings where id = v_g;
  insert into r values ('coworkers accepted', v_val);
  update gatherings set party_type = 'new_people' where id = v_g;
  begin update gatherings set party_type = 'aliens' where id = v_g; exception when others then insert into r values ('unknown refused', 'check'); end;
end $t$;
select * from r
union all select 'constraints with new', count(*)::text from pg_constraint where pg_get_constraintdef(oid) like '%''coworkers''%'
union all select 'fns with new', count(*)::text from pg_proc where pronamespace='public'::regnamespace and pg_get_functiondef(oid) like '%''coworkers''%';
rollback;
