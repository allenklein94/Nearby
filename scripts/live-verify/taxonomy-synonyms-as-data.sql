-- 20270191: resolving an emerging category also teaches its wordings as synonyms; admin-only synonym add; readable list.
do $$
declare res text:=''; c int; r record; admin_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (admin_id), (other_id);
  perform set_config('app.trusted_update','true',true);
  insert into profiles (id, is_admin, display_name, birthdate) values (admin_id, false, 'Admin', '1990-01-01'), (other_id, false, 'Other', '1990-01-01');
  update profiles set is_admin = true where id = admin_id;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('a','Padel courts','a@x.com','n','7001','web'),('b','padel club','b@x.com','n','7002','web'),('c','Padel Tennis','c@x.com','n','7003','web'),('d','padel','d@x.com','n','7004','web');
  perform set_config('request.jwt.claims', json_build_object('sub',other_id,'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  set local role authenticated;
  begin perform admin_add_category_synonym('cafe latte','Coffee'); res:=res||E'non-admin add synonym: ALLOWED (bad)\n'; exception when others then res:=res||E'non-admin add synonym refused\n'; end;
  select count(*) into c from get_category_synonyms(); res:=res||'signed-in can read '||c||E' synonym rows\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  begin perform admin_add_category_synonym('x','No Such Tag'); res:=res||E'unknown tag: ALLOWED (bad)\n'; exception when others then res:=res||E'unknown tag refused\n'; end;
  res:=res||'admin added: '||admin_add_category_synonym('Cafe  Latte!','Coffee')||E'\n';
  perform admin_resolve_emerging_category('padel','Padel','activities_recreation');
  for r in select phrase, tag from get_category_synonyms() where tag='Padel' order by 1 loop res:=res||'synonym: '||r.phrase||' -> '||r.tag||E'\n'; end loop;
  reset role;
  raise exception E'RESULT\n%', res;
end $$;
