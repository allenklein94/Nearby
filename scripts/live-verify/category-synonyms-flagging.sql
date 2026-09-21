-- 20270190: a phrase that is a known synonym is never proposed as a new category; an unknown repeated one still is.
do $$
declare res text:=''; c int; r record; admin_id uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (admin_id);
  perform set_config('app.trusted_update','true',true);
  insert into profiles (id, is_admin, display_name, birthdate) values (admin_id, false, 'Admin', '1990-01-01');
  update profiles set is_admin = true where id = admin_id;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('c1','Cafe','c1@x.com','n','5001','web'),('c2','coffee shop','c2@x.com','n','5002','web'),('c3','Cafes','c3@x.com','n','5003','web'),
    ('g1','fitness center','g1@x.com','n','5004','web'),('g2','Gym','g2@x.com','n','5005','web'),('g3','fitness centre','g3@x.com','n','5006','web'),
    ('p1','axe throwing','p1@x.com','n','5007','web'),('p2','Axe Throwing','p2@x.com','n','5008','web'),('p3','axe-throwing','p3@x.com','n','5009','web');
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  for r in select * from admin_get_emerging_categories() loop res:=res||'flagged: '||r.phrase_key||' ('||r.applicants||E')\n'; end loop;
  reset role;
  raise exception E'RESULT\n%', res;
end $$;
