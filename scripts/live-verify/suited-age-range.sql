-- Verifies migration 20270199 (suited age range; set_business_suited_ages). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_partner uuid; v_owner uuid; v_stranger uuid; v_g uuid; v_min int; v_max int;
begin
  select managed_partner_id, id into v_partner, v_owner from profiles where managed_partner_id is not null limit 1;
  select id into v_stranger from profiles where managed_partner_id is distinct from v_partner and id <> v_owner limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_business_suited_ages(v_partner, 3, 8);
  select suited_age_min, suited_age_max into v_min, v_max from brand_partners where id = v_partner;
  insert into r values ('owner sets 3-8', v_min || '-' || v_max);
  perform set_business_suited_ages(v_partner, 5, null);
  select suited_age_min, suited_age_max into v_min, v_max from brand_partners where id = v_partner;
  insert into r values ('open upper bound', v_min || '-' || coalesce(v_max::text, 'open'));
  begin perform set_business_suited_ages(v_partner, 9, 3); exception when others then insert into r values ('min above max refused', sqlerrm); end;
  begin perform set_business_suited_ages(v_partner, 3, 40); exception when others then insert into r values ('out of range refused', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin perform set_business_suited_ages(v_partner, 1, 2); exception when others then insert into r values ('stranger refused', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_business_suited_ages(v_partner, null, null);
  select suited_age_min, suited_age_max into v_min, v_max from brand_partners where id = v_partner;
  insert into r values ('cleared', coalesce(v_min::text, 'null') || '/' || coalesce(v_max::text, 'null'));
  reset role;
  select id into v_g from gatherings limit 1;
  update gatherings set suited_age_min = 3, suited_age_max = 8 where id = v_g;
  insert into r values ('gathering accepts range', (select suited_age_min || '-' || suited_age_max from gatherings where id = v_g));
  begin update gatherings set suited_age_min = 9, suited_age_max = 3 where id = v_g; exception when others then insert into r values ('gathering min>max refused', 'yes'); end;
  insert into r values ('single overload', (select count(*)::text from pg_proc where proname = 'set_business_suited_ages'));
end $t$;
select * from r;
rollback;
