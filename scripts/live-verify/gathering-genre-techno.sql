-- Verifies migration 20270215. Rolled back: a host saves Techno and edits it to Jazz and back through RLS, every earlier genre is
-- still accepted, an unknown genre is refused, a stranger's update touches 0 rows.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_g uuid; v_host uuid; v_other uuid; v_val text; v_n int; k text;
begin
  select id, host_id into v_g, v_host from gatherings limit 1;
  select id into v_other from profiles where id <> v_host limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update gatherings set genre = 'techno' where id = v_g;
  select genre into v_val from gatherings where id = v_g;
  insert into r values ('host saves techno', v_val);
  update gatherings set genre = 'jazz' where id = v_g;
  update gatherings set genre = 'techno' where id = v_g;
  select genre into v_val from gatherings where id = v_g;
  insert into r values ('host edits jazz -> techno', v_val);
  foreach k in array array['rock','pop','jazz','blues','country','hip_hop','electronic','classical','folk','latin','r_and_b','open_mic'] loop
    update gatherings set genre = k where id = v_g;
  end loop;
  insert into r values ('all old genres still valid', 'ok');
  begin update gatherings set genre = 'polka' where id = v_g; insert into r values ('unknown refused', 'NOT REFUSED');
  exception when check_violation then insert into r values ('unknown refused', 'check'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  update gatherings set genre = 'techno' where id = v_g;
  get diagnostics v_n = row_count;
  insert into r values ('stranger update rows', v_n::text);
end $t$;
reset role;
insert into r select 'check accepts techno', (pg_get_constraintdef(oid) like '%''techno''%')::text from pg_constraint where conname = 'gatherings_genre_check';
select * from r;
rollback;
