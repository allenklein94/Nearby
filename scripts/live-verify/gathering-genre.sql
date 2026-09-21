-- Verifies migration 20270195. Rolled back: host sets a genre through RLS, an unknown genre is refused.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_g uuid; v_host uuid; v_val text;
begin
  select id, host_id into v_g, v_host from gatherings limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update gatherings set genre = 'jazz' where id = v_g;
  select genre into v_val from gatherings where id = v_g;
  insert into r values ('host set genre', v_val);
  begin update gatherings set genre = 'polka' where id = v_g; exception when others then insert into r values ('unknown refused', 'check'); end;
end $t$;
select * from r;
rollback;
