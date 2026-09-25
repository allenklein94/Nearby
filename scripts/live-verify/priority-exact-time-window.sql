-- Verifies migration 20270204 (owner item 56 follow-up): an optional exact time-of-day preference ("4-7 PM"),
-- additive to the coarse priority_time_windows buckets, never an availability promise. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_owner uuid; v_partner uuid; v_other uuid;
begin
  select id into v_partner from brand_partners where active limit 1;
  select id into v_owner from profiles where id <> (select host_id from gatherings limit 1) and managed_partner_id is null limit 1;
  update profiles set managed_partner_id = v_partner where id = v_owner;
  select id into v_other from profiles where id <> v_owner and managed_partner_id is null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- 1. owner sets a real window
  perform set_business_priority_time_range(v_partner, '16:00'::time, '19:00'::time);
  insert into r values ('owner sets 16:00-19:00', (select priority_time_start::text || '-' || priority_time_end::text from brand_partners where id = v_partner));

  -- 2. end not after start refused
  begin
    perform set_business_priority_time_range(v_partner, '19:00'::time, '16:00'::time);
    insert into r values ('end before start', 'ACCEPTED (bad)');
  exception when others then
    insert into r values ('end before start', 'refused: ' || sqlerrm);
  end;

  -- 3. only one side set refused
  begin
    perform set_business_priority_time_range(v_partner, '16:00'::time, null);
    insert into r values ('only start set', 'ACCEPTED (bad)');
  exception when others then
    insert into r values ('only start set', 'refused: ' || sqlerrm);
  end;

  -- 4. clearing both is allowed
  perform set_business_priority_time_range(v_partner, null, null);
  insert into r values ('cleared', coalesce((select priority_time_start::text from brand_partners where id = v_partner), 'NULL'));

  -- restore for the non-owner check
  perform set_business_priority_time_range(v_partner, '16:00'::time, '19:00'::time);

  -- 5. a non-owner cannot set it
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    perform set_business_priority_time_range(v_partner, '10:00'::time, '12:00'::time);
    insert into r values ('non-owner sets window', 'ACCEPTED (bad)');
  exception when others then
    insert into r values ('non-owner sets window', 'refused: ' || sqlerrm);
  end;
  insert into r values ('window unchanged after non-owner attempt', (select priority_time_start::text || '-' || priority_time_end::text from brand_partners where id = v_partner));

  -- 6. single overload
  insert into r values ('overloads (should be 1)', (select count(*)::text from pg_proc where proname = 'set_business_priority_time_range'));
end $$;
select * from r;
rollback;
