-- Verifies migration 20270218 (item 82). Rolled back; the result is reported through the exception text.
--  * $$$$ accepted, free and junk refused (CHECK + setter); typical spend 1-1000, 0 / 1001 refused; clear to null
--  * a non-owner is refused by both setters; anon cannot execute
begin;
do $v$
declare out text := ''; pid uuid; owner_id uuid; other_id uuid;
begin
  select id into pid from brand_partners limit 1;
  select id into owner_id from profiles limit 1;
  select id into other_id from profiles where id <> owner_id limit 1;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = pid where id = owner_id;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_business_price_level(pid, '$$$$');
  out := out || 'tier $$$$: ' || (select price_level from brand_partners where id = pid) || E'\n';
  begin perform set_business_price_level(pid, 'free'); out := out || 'free: NOT REFUSED' || E'\n';
  exception when others then out := out || 'free refused: ok' || E'\n'; end;
  begin update brand_partners set price_level = 'free' where id = pid; out := out || 'free CHECK: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'free CHECK refused: ok' || E'\n'; end;
  perform set_business_typical_spend(pid, 25);
  out := out || 'spend: ' || (select typical_spend_per_person from brand_partners where id = pid) || E'\n';
  begin perform set_business_typical_spend(pid, 0); out := out || '0: NOT REFUSED' || E'\n';
  exception when others then out := out || '0 refused: ok' || E'\n'; end;
  begin perform set_business_typical_spend(pid, 1001); out := out || '1001: NOT REFUSED' || E'\n';
  exception when others then out := out || '1001 refused: ok' || E'\n'; end;
  perform set_business_typical_spend(pid, null);
  out := out || 'cleared: ' || coalesce((select typical_spend_per_person::text from brand_partners where id = pid), 'null') || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin perform set_business_typical_spend(pid, 30); out := out || 'non-owner spend: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-owner spend refused: ok' || E'\n'; end;
  begin perform set_business_price_level(pid, '$'); out := out || 'non-owner tier: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-owner tier refused: ok' || E'\n'; end;
  out := out || 'anon execute spend: ' || has_function_privilege('anon', 'public.set_business_typical_spend(uuid, integer)', 'execute')::text || E'\n';
  raise exception '%', out;
end $v$;
rollback;
