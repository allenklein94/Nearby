-- Full lifecycle of the emerging-categories loop (20270188 + 20270189). ROLLED BACK; runs on prod or a replay database.
-- Rewritten 2026-09-27: the original used "padel", which became canonical on 2026-09-26 (20270213). "Curling" (checked:
-- not a tag, synonym, alias or former name) now walks the lifecycle, and the current state is asserted: Padel is an
-- existing category, so "padel" applicants are never a candidate and future "padel" text never flags a duplicate.
begin;
do $$
declare
  r record; n int; pid uuid;
  admin_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
  ok boolean;
begin
  assert not exists (select 1 from category_tag_groups where _category_search_key(tag) = 'curling'), 'precondition: curling is not a category';
  assert exists (select 1 from category_tag_groups where tag = 'Padel' and retired_at is null), 'precondition: Padel is canonical';
  insert into auth.users (id) values (admin_id), (other_id);
  perform set_config('app.trusted_update', 'true', true);
  insert into profiles (id, is_admin, display_name, birthdate) values (admin_id, false, 'Admin', '1990-01-01'), (other_id, false, 'Other', '1990-01-01');
  update profiles set is_admin = true where id = admin_id;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- 1-2: business A (twice, same email in another case), business B: 2 businesses, below the threshold of 3
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('A', 'Curling rink', 'a@x.com', 'n', '1001', 'web');
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source, status) values
    ('A again', 'CURLING RINK!!', 'A@x.com', 'n', '1002', 'web', 'denied');
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('B', 'curling', 'b@x.com', 'n', '1003', 'web');
  set local role authenticated;
  assert not exists (select 1 from admin_get_emerging_categories() where phrase_key like 'curling%'), 'A twice + B = 2 businesses: not flagged';
  begin perform admin_resolve_emerging_category('curling', 'Curling', 'activities_recreation'); ok := false;
  exception when others then ok := sqlerrm ilike '%threshold%'; end;
  assert ok, 'resolving below the threshold is refused';
  reset role;

  -- 3: business C "Curling lessons" joins the "curling" cluster (someone typed the one word); approved, with a live business
  insert into brand_partners (name, category) values ('C Curling Club', 'activities_recreation') returning id into pid;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source, status, resulting_partner_id) values
    ('C', 'Curling lessons', 'c@x.com', 'n', '1004', 'web', 'approved', pid);
  -- existing canonical tags x3 are never candidates: Tennis, and Padel (canonical since 2026-09-26)
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('T1', 'tennis', 't1@x.com', 'n', '2001', 'web'), ('T2', 'Tennis courts', 't2@x.com', 'n', '2002', 'web'), ('T3', 'tennis club', 't3@x.com', 'n', '2003', 'web'),
    ('P1', 'padel', 'p1@x.com', 'n', '2101', 'web'), ('P2', 'Padel courts', 'p2@x.com', 'n', '2102', 'web'), ('P3', 'PADEL CLUB', 'p3@x.com', 'n', '2103', 'web');
  -- a different concept below the threshold must not merge
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('X1', 'table tennis', 'x1@x.com', 'n', '3001', 'web'), ('X2', 'Table Tennis', 'x2@x.com', 'n', '3002', 'web');

  -- 4: nobody but an admin can see or act
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from admin_get_emerging_categories(); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin list refused';
  begin perform admin_resolve_emerging_category('curling', 'Curling', 'activities_recreation'); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin resolve refused';
  begin perform admin_dismiss_emerging_category('curling'); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin dismiss refused';
  begin perform admin_add_category_tag('Curling', 'activities_recreation'); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin add tag refused';
  begin perform * from _category_candidate_rows(); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin internal rows refused';
  reset role;

  -- 5-6: flagged exactly once (not tennis, not padel, not table tennis), then confirmed by the admin
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from admin_get_emerging_categories()) = 1, 'exactly one candidate';
  select * into r from admin_get_emerging_categories();
  assert r.phrase_key = 'curling' and r.applicants = 3, format('curling with 3 businesses (got %s / %s)', r.phrase_key, r.applicants);
  n := admin_resolve_emerging_category('curling', 'Curling', 'activities_recreation');
  assert n = 4, format('4 applications mapped: A, A again, B, C (got %s)', n);
  reset role;
  assert (select count(*) from business_partner_requests where subcategory = 'Curling') = 4, 'requests now Curling';
  assert exists (select 1 from brand_partners where id = pid and subcategory = 'Curling'), 'approved business updated';

  -- 8-10: no candidate remains; future text suggests the new tag; more of it never flags a duplicate; padel likewise
  set local role authenticated;
  assert (select count(*) from admin_get_emerging_categories()) = 0, 'no candidates after (existing tags exclude them)';
  select * into r from suggest_category_from_aliases('We run a curling league');
  assert r.subcategory = 'Curling', 'future text suggests Curling';
  reset role;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('D', 'Curling rink', 'd@x.com', 'n', '1005', 'web'), ('E', 'curling', 'e@x.com', 'n', '1006', 'web'), ('F', 'CURLING', 'f@x.com', 'n', '1007', 'web'),
    ('P4', 'padel', 'p4@x.com', 'n', '2104', 'web');
  set local role authenticated;
  assert (select count(*) from admin_get_emerging_categories()) = 0, 'three more curling + more padel: no duplicate candidate';
  reset role;
end $$;
select 'ALL OK' as result;
rollback;
