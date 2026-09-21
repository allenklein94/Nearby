do $$
declare res text:=''; n int; c int; admin_id uuid := 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; other_id uuid := 'd15758e7-63d0-450c-9475-9188f26a50ec'; sub text; r record;
begin
  -- MIGRATION_PLACEHOLDER
  -- 4 distinct applicants say padel (one repeats), 2 say axe throwing, 3 say tennis (existing tag)
  insert into business_partner_requests (requester_id, business_name, unlisted_category_text, applicant_email, source) values
   (other_id,'a','Padel courts','a@x.com','web'),(other_id,'b','padel court','b@x.com','web'),(other_id,'c','PADEL','c@x.com','web'),
   (other_id,'d','Padel!','c@x.com','web'),(other_id,'e','padel courts','d@x.com','web'),
   (other_id,'f','axe throwing','e@x.com','web'),(other_id,'g','Axe Throwing','f@x.com','web'),
   (other_id,'h','tennis','g@x.com','web'),(other_id,'i','Tennis','h@x.com','web'),(other_id,'j','tennis','i@x.com','web');
  perform set_config('request.jwt.claims', json_build_object('sub',other_id,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform * from admin_get_emerging_categories(); res:=res||E'non-admin list: ALLOWED (bad)\n'; exception when others then res:=res||E'non-admin list refused\n'; end;
  begin perform admin_resolve_emerging_category('padel','Padel','activities_recreation'); res:=res||E'non-admin resolve: ALLOWED (bad)\n'; exception when others then res:=res||E'non-admin resolve refused\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  set local role authenticated;
  for r in select * from admin_get_emerging_categories() loop res:=res||'flag: '||r.phrase_key||' / '||r.sample_phrase||' / '||r.applicants||E'\n'; end loop;
  n := admin_resolve_emerging_category('padel court','Padel','activities_recreation');
  res:=res||'resolved, mapped '||n||E'\n';
  reset role;
  select count(*) into c from business_partner_requests where subcategory='Padel' and category='activities_recreation'; res:=res||'rows now Padel: '||c||E'\n';
  select count(*) into c from category_tag_groups where tag='Padel'; res:=res||'tag exists: '||c||E'\n';
  set local role authenticated;
  select count(*) into c from admin_get_emerging_categories() where phrase_key like 'padel%'; res:=res||'padel still flagged: '||c||E'\n';
  perform admin_dismiss_emerging_category('axe throwing');
  select count(*) into c from admin_get_emerging_categories(); res:=res||'flags after dismiss: '||c||E'\n';
  reset role;
  raise exception E'RESULT\n%', res;
end $$;
