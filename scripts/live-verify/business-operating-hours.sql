-- Verifies migration 20270211 (owner-declared operating hours). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_partner uuid; v_owner uuid; v_stranger uuid; v_val jsonb; v_week jsonb; v_n int;
begin
  select managed_partner_id, id into v_partner, v_owner from profiles where managed_partner_id is not null limit 1;
  select id into v_stranger from profiles where managed_partner_id is distinct from v_partner and id <> v_owner limit 1;
  v_week := '{"sun":"closed","mon":[["09:00","14:00"],["17:00","22:00"]],"tue":"all_day","wed":[["18:00","02:00"]],"thu":[["09:00","17:00"]],"fri":[["09:00","17:00"]],"sat":[["10:00","16:00"]]}';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'America/Los_Angeles', 'week', v_week,
    'special', '[{"date":"2026-12-25","hours":"closed"}]'::jsonb, 'temporarily_closed', false));
  select operating_hours into v_val from brand_partners where id = v_partner;
  insert into r values ('owner saved split/overnight/24h/special', v_val -> 'week' ->> 'wed');
  begin perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'Mars/Olympus', 'week', v_week));
    exception when others then insert into r values ('bad timezone refused', sqlerrm); end;
  begin perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'UTC', 'week', v_week || '{"mon":[["09:00","14:00"],["13:00","15:00"]]}'));
    exception when others then insert into r values ('overlap refused', sqlerrm); end;
  begin perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'UTC', 'week', v_week || '{"wed":[["18:00","10:00"]]}'));
    exception when others then insert into r values ('overnight into next day refused', sqlerrm); end;
  begin perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'UTC', 'week', v_week - 'sat'));
    exception when others then insert into r values ('missing day refused', sqlerrm); end;
  begin perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'UTC', 'week', v_week || '{"mon":[["25:00","14:00"]]}'));
    exception when others then insert into r values ('invalid time refused', sqlerrm); end;
  begin perform set_business_operating_hours(v_partner, jsonb_build_object('timezone', 'UTC', 'week', v_week || '{"mon":[["09:00","09:00"]]}'));
    exception when others then insert into r values ('zero-length refused', sqlerrm); end;
  update brand_partners set operating_hours = '{"timezone":"UTC","week":{"sun":"closed"}}' where id = v_partner;
  get diagnostics v_n = row_count;
  insert into r values ('owner direct write rows (RLS, expect 0)', v_n::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin perform set_business_operating_hours(v_partner, null); exception when others then insert into r values ('stranger refused', sqlerrm); end;
  select operating_hours into v_val from brand_partners where id = v_partner;
  insert into r values ('consumer can read hours', coalesce(v_val ->> 'timezone', 'NOT READABLE'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_business_operating_hours(v_partner, null);
  select operating_hours into v_val from brand_partners where id = v_partner;
  insert into r values ('cleared = unknown', coalesce(v_val::text, 'NULL'));
end $$;
reset role;
do $$ begin
  update brand_partners set operating_hours = '{"timezone":"UTC","week":{"sun":"closed"}}' where id = (select id from brand_partners limit 1);
  insert into r values ('CHECK on privileged write', 'NOT REFUSED');
exception when check_violation then insert into r values ('CHECK on privileged write refused', sqlerrm); end $$;
insert into r select 'setter overloads', count(*)::text from pg_proc where proname = 'set_business_operating_hours';
insert into r select 'anon can execute setter', has_function_privilege('anon', 'public.set_business_operating_hours(uuid, jsonb)', 'execute')::text;
select * from r;
rollback;
