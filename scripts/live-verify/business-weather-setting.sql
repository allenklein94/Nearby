-- Verifies migration 20270162 (set_business_weather_setting). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_partner uuid; v_owner uuid; v_stranger uuid; v_val text; v_err text;
begin
  select managed_partner_id, id into v_partner, v_owner from profiles where managed_partner_id is not null limit 1;
  select id into v_stranger from profiles where managed_partner_id is distinct from v_partner and id <> v_owner limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_business_weather_setting(v_partner, 'outdoor');
  select weather_setting into v_val from brand_partners where id = v_partner;
  insert into r values ('owner set outdoor', v_val);
  begin perform set_business_weather_setting(v_partner, 'sunny'); exception when others then insert into r values ('invalid refused', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin perform set_business_weather_setting(v_partner, 'indoor'); exception when others then insert into r values ('stranger refused', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_business_weather_setting(v_partner, null);
  select weather_setting into v_val from brand_partners where id = v_partner;
  insert into r values ('cleared', coalesce(v_val, 'NULL'));
end $$;
select * from r;
rollback;
