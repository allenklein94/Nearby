-- Live verification for 20270145 (Management API; final RAISE rolls back everything, including the migration).
-- Expected: null-category application inserts; unknown category / wrong subcategory / non-admin refused; admin map
-- updates request + remembered phrase; suggestion returns the mapped category; bad alias rejected.
do $$
declare res text:=''; rid uuid; c text; s text; ph text; admin_id uuid := 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; other_id uuid := 'd15758e7-63d0-450c-9475-9188f26a50ec';
begin
  -- MIGRATION_PLACEHOLDER
  insert into business_partner_requests (requester_id, business_name, category, unlisted_category_text)
  values (other_id, 'Verify Roasters', null, 'small batch coffee roaster') returning id into rid;
  res:=res||E'null-category application with description: OK\n';
  begin insert into business_partner_requests (requester_id, business_name, unlisted_category_text) values (other_id,'x','ab'); res:=res||E'2-char text: ALLOWED (bad)\n'; exception when check_violation then res:=res||E'2-char text refused\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub',other_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform admin_map_business_category(rid,'food_drink','Coffee','coffee roaster'); res:=res||E'non-admin map: ALLOWED (bad)\n'; exception when others then res:=res||'non-admin map refused: '||sqlerrm||E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform admin_map_business_category(rid,'made_up'); res:=res||E'unknown category: ALLOWED (bad)\n'; exception when others then res:=res||'unknown category refused: '||sqlerrm||E'\n'; end;
  begin perform admin_map_business_category(rid,'food_drink','Fitness'); res:=res||E'wrong subcategory: ALLOWED (bad)\n'; exception when others then res:=res||'wrong subcategory refused: '||sqlerrm||E'\n'; end;
  begin perform admin_map_business_category(rid,'food_drink','Coffee','x'); res:=res||E'1-char phrase: ALLOWED (bad)\n'; exception when others then res:=res||'1-char phrase refused: '||sqlerrm||E'\n'; end;
  perform admin_map_business_category(rid,'food_drink','Coffee','  Coffee Roaster ');
  perform admin_map_business_category(rid,'home_local_services');  -- tagless major is valid
  perform admin_map_business_category(rid,'food_drink','Coffee','coffee roaster');
  reset role;
  select category, subcategory into c, s from business_partner_requests where id = rid;
  res:=res||'request mapped to '||c||'/'||s||E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub',other_id,'role','authenticated')::text, true);
  set local role authenticated;
  select category, subcategory, phrase into c, s, ph from suggest_category_from_aliases('We are a Coffee Roaster downtown');
  res:=res||'suggestion: '||coalesce(c,'none')||'/'||coalesce(s,'-')||' via "'||coalesce(ph,'')||E'"\n';
  select category into c from suggest_category_from_aliases('yoga studio'); res:=res||'unrelated text suggests: '||coalesce(c,'nothing')||E'\n';
  begin perform count(*) from category_aliases; res:=res||E'direct alias read: ALLOWED (bad)\n'; exception when others then res:=res||E'direct alias read refused\n'; end;
  reset role;
  raise exception E'RESULT\n%', res;
end $$;
