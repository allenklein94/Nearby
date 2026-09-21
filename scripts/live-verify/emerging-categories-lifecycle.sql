-- Full lifecycle for the emerging-categories loop (migrations 20270188 + 20270189). Run on a from-scratch replay database
-- (or prod inside a rolled-back txn: it needs two real profile ids, edit admin_id/other_id). Ends in RAISE = rollback.
do $$
declare res text:=''; r record; n int; c int; pid uuid; rid_approved uuid;
  admin_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (admin_id), (other_id);
  perform set_config('app.trusted_update','true',true); insert into profiles (id, is_admin, display_name, birthdate) values (admin_id, false, 'Admin', '1990-01-01'), (other_id, false, 'Other', '1990-01-01'); update profiles set is_admin = true where id = admin_id;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true); perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  select count(*) into c from admin_get_emerging_categories(); res:=res||'1 start, candidates: '||c||E'\n';
  reset role;
  -- Business A (twice: same email, resubmitted), Business B
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('A','Padel courts','a@x.com','n','1001','web');
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source, status) values
    ('A again','PADEL COURT!!','A@x.com','n','1002','web','denied');
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('B','padel','b@x.com','n','1003','web');
  set local role authenticated;
  select count(*) into c from admin_get_emerging_categories(); res:=res||'2 A (twice) + B = 2 businesses, candidates: '||c||E'\n';
  begin perform admin_resolve_emerging_category('padel','Padel','activities_recreation'); res:=res||E'3 resolve below threshold: ALLOWED (bad)\n'; exception when others then res:=res||'3 resolve below threshold refused: '||sqlerrm||E'\n'; end;
  reset role;
  -- Business C: "Padel tennis" (joins the "padel" cluster because "padel" was typed); approved, with a live business
  insert into brand_partners (name, category) values ('C Padel Club', 'activities_recreation') returning id into pid;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source, status, resulting_partner_id) values
    ('C','Padel tennis','c@x.com','n','1004','web','approved', pid) returning id into rid_approved;
  -- an existing tag ("Tennis") x3 must never be a candidate
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('T1','tennis','t1@x.com','n','2001','web'),('T2','Tennis courts','t2@x.com','n','2002','web'),('T3','tennis club','t3@x.com','n','2003','web');
  -- a non-flagged, different concept must not merge
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('X1','table tennis','x1@x.com','n','3001','web'),('X2','Table Tennis','x2@x.com','n','3002','web');
  perform set_config('request.jwt.claims', json_build_object('sub',other_id,'role','authenticated')::text, true); perform set_config('request.jwt.claim.sub', other_id::text, true);
  set local role authenticated;
  begin perform * from admin_get_emerging_categories(); res:=res||E'4 non-admin list: ALLOWED (bad)\n'; exception when others then res:=res||E'4 non-admin list refused\n'; end;
  begin perform admin_resolve_emerging_category('padel','Padel','activities_recreation'); res:=res||E'4 non-admin resolve: ALLOWED (bad)\n'; exception when others then res:=res||E'4 non-admin resolve refused\n'; end;
  begin perform admin_dismiss_emerging_category('padel'); res:=res||E'4 non-admin dismiss: ALLOWED (bad)\n'; exception when others then res:=res||E'4 non-admin dismiss refused\n'; end;
  begin perform admin_add_category_tag('Padel','activities_recreation'); res:=res||E'4 non-admin add tag: ALLOWED (bad)\n'; exception when others then res:=res||E'4 non-admin add tag refused\n'; end;
  begin perform * from _category_candidate_rows(); res:=res||E'4 non-admin internal rows: ALLOWED (bad)\n'; exception when others then res:=res||E'4 non-admin internal rows refused\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true); perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  for r in select * from admin_get_emerging_categories() loop
    res:=res||'5 flagged once: '||r.phrase_key||' / '||r.applicants||' businesses / wordings '||r.wordings::text||E'\n'; end loop;
  select count(*) into c from admin_get_emerging_categories(); res:=res||'5 candidate count: '||c||E' (expect 1: not tennis, not table tennis)\n';
  n := admin_resolve_emerging_category('padel','Padel','activities_recreation');
  res:=res||'6 admin confirmed, applications mapped: '||n||E'\n';
  reset role;
  select count(*) into c from business_partner_requests where subcategory='Padel'; res:=res||'7 requests now Padel: '||c||E' (expect 4: A, A again, B, C)\n';
  select count(*) into c from brand_partners where id=pid and subcategory='Padel'; res:=res||'7b approved business updated to Padel: '||c||E'\n';
  set local role authenticated;
  select count(*) into c from admin_get_emerging_categories(); res:=res||'8 candidates after: '||c||E' (existing tag now excludes it)\n';
  for r in select category, subcategory, phrase from suggest_category_from_aliases('We run a padel league') loop res:=res||'9 future text suggests: '||r.category||'/'||r.subcategory||' via "'||r.phrase||E'"\n'; end loop;
  reset role;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('D','Padel courts','d@x.com','n','1005','web'),('E','padel','e@x.com','n','1006','web'),('F','PADEL','f@x.com','n','1007','web');
  set local role authenticated;
  select count(*) into c from admin_get_emerging_categories(); res:=res||'10 three more "padel" after the tag exists, candidates: '||c||E' (expect 0, no duplicate)\n';
  reset role;
  raise exception E'RESULT\n%', res;
end $$;
