-- Live verification for 20270160 (Management API). Prepend the migration text; the final RAISE rolls back everything.
-- Expected: non-admin/unknown group/bad name/duplicate refused; admin adds "Padel"; the new tag is accepted for a business
-- subcategory, secondary categories, and a request category; an unknown tag is refused by the FK/trigger; clients cannot
-- write category_tag_groups; update_business_profile accepts Florist (was drift) and the new tag.
do $$
declare res text:=''; n int; admin_id uuid := 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; other_id uuid := 'd15758e7-63d0-450c-9475-9188f26a50ec';
  pid uuid := '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; b brand_partners%rowtype; t text;
begin
  select * into b from brand_partners where id = pid;
  perform set_config('request.jwt.claims', json_build_object('sub',other_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform admin_add_category_tag('Padel','activities_recreation'); res:=res||E'non-admin add: ALLOWED (bad)\n'; exception when others then res:=res||'non-admin add refused: '||sqlerrm||E'\n'; end;
  begin insert into category_tag_groups(tag,group_key) values ('Sneaky','pets'); res:=res||E'direct insert: ALLOWED (bad)\n'; exception when others then res:=res||E'direct insert refused\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform admin_add_category_tag('Padel','made_up'); res:=res||E'unknown group: ALLOWED (bad)\n'; exception when others then res:=res||'unknown group refused: '||sqlerrm||E'\n'; end;
  begin perform admin_add_category_tag('x','pets'); res:=res||E'1-char name: ALLOWED (bad)\n'; exception when others then res:=res||E'1-char name refused\n'; end;
  begin perform admin_add_category_tag('Drop;Table','pets'); res:=res||E'punctuation name: ALLOWED (bad)\n'; exception when others then res:=res||E'punctuation name refused\n'; end;
  begin perform admin_add_category_tag('pickleball','activities_recreation'); res:=res||E'case-insensitive duplicate: ALLOWED (bad)\n'; exception when others then res:=res||'duplicate refused: '||sqlerrm||E'\n'; end;
  t := admin_add_category_tag('  Padel   Tennis ','activities_recreation');
  res:=res||'admin added: "'||t||E'"\n';
  reset role;
  select count(*) into n from category_tag_groups; res:=res||'tags now: '||n||E'\n';
  res:=res||'valid new tag: '||is_valid_category_tag(t)||', unknown: '||is_valid_category_tag('Nope')||E'\n';
  update brand_partners set subcategory = t, categories = array[t] where id = pid;
  res:=res||E'business subcategory + categories accept the new tag\n';
  begin update brand_partners set subcategory = 'Nope' where id = pid; res:=res||E'unknown subcategory: ALLOWED (bad)\n'; exception when foreign_key_violation then res:=res||E'unknown subcategory refused (FK)\n'; end;
  begin update brand_partners set categories = array['Coffee','Nope'] where id = pid; res:=res||E'unknown secondary: ALLOWED (bad)\n'; exception when check_violation then res:=res||E'unknown secondary refused (trigger)\n'; end;
  update business_requests set category = t where id = (select id from business_requests limit 1);
  res:=res||E'request category accepts the new tag\n';
  begin update business_requests set category = 'Nope' where id = (select id from business_requests limit 1); res:=res||E'unknown request category: ALLOWED (bad)\n'; exception when foreign_key_violation then res:=res||E'unknown request category refused (FK)\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  perform update_business_profile(pid, b.name, b.description, b.address, b.latitude, b.longitude, b.logo_url, 'shopping', null, null, null, 'Florist', array[t]);
  res:=res||E'update_business_profile accepts shopping/Florist + new secondary tag\n';
  perform update_business_profile(pid, b.name, b.description, b.address, b.latitude, b.longitude, b.logo_url, 'activities_recreation', null, null, null, t, null);
  res:=res||E'update_business_profile accepts the new tag as a subcategory\n';
  begin perform update_business_profile(pid, b.name, b.description, b.address, b.latitude, b.longitude, b.logo_url, 'pets', null, null, null, t, null); res:=res||E'tag under the wrong group: ALLOWED (bad)\n'; exception when others then res:=res||'wrong-group subcategory refused: '||sqlerrm||E'\n'; end;
  reset role;
  select count(*) into n from pg_proc where proname='update_business_profile'; res:=res||'update_business_profile overloads: '||n||E'\n';
  raise exception E'RESULT\n%', res;
end $$;
