-- Verifies migration 20270194. Rolled back. The host writes through RLS; a stranger cannot; out-of-range duration refused.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_g uuid; v_host uuid; v_stranger uuid; v_n int; v_eq boolean; v_d int;
begin
  select id, host_id into v_g, v_host from gatherings limit 1;
  select id into v_stranger from profiles where id <> v_host limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update gatherings set equipment_provided = true, duration_minutes = 90 where id = v_g;
  select equipment_provided, duration_minutes into v_eq, v_d from gatherings where id = v_g;
  insert into r values ('host wrote', v_eq::text || '/' || v_d::text);
  begin update gatherings set duration_minutes = 5 where id = v_g; exception when others then insert into r values ('short refused', 'check'); end;
  begin update gatherings set duration_minutes = 9999 where id = v_g; exception when others then insert into r values ('long refused', 'check'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  update gatherings set duration_minutes = 30 where id = v_g;
  get diagnostics v_n = row_count;
  insert into r values ('stranger rows updated', v_n::text);
end $t$;
select * from r;
rollback;
