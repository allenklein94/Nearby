-- Emerging categories (migrations 20270188 + 20270189). ROLLED BACK. Rewritten 2026-09-27: the original used "padel",
-- which became a canonical category on 2026-09-26 (20270213), so it could no longer be an emerging one. "Curling" (checked
-- live: not a tag, synonym, alias or former name) now plays the emerging concept, and the script also asserts the current
-- state: applicants who say "padel" map to the existing Padel category and are never proposed as a new one.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
  n int; ok boolean; r record;
begin
  assert not exists (select 1 from category_tag_groups where _category_search_key(tag) = 'curling'), 'precondition: curling is not a category';
  assert exists (select 1 from category_tag_groups where tag = 'Padel' and retired_at is null), 'precondition: Padel is canonical';
  insert into auth.users (id) values (admin_id), (other_id);
  perform set_config('app.trusted_update', 'true', true);
  insert into profiles (id, is_admin, display_name, birthdate) values (admin_id, false, 'Admin', '1990-01-01'), (other_id, false, 'Other', '1990-01-01');
  update profiles set is_admin = true where id = admin_id;
  -- 4 distinct businesses say curling (one email twice), 2 say axe throwing, 3 say padel (canonical), 3 say tennis (canonical)
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
   ('a','Curling rink','a@x.com','n','8001','web'),('b','curling club','b@x.com','n','8002','web'),('c','CURLING','c@x.com','n','8003','web'),
   ('d','Curling!','c@x.com','n','8004','web'),('e','curling clubs','d@x.com','n','8005','web'),
   ('f','axe throwing','e@x.com','n','8006','web'),('g','Axe Throwing','f@x.com','n','8007','web'),
   ('p1','Padel courts','p1@x.com','n','8101','web'),('p2','padel','p2@x.com','n','8102','web'),('p3','Padel club','p3@x.com','n','8103','web'),
   ('h','tennis','g@x.com','n','8008','web'),('i','Tennis','h@x.com','n','8009','web'),('j','tennis','i@x.com','n','8010','web');

  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from admin_get_emerging_categories(); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin cannot list';
  begin perform admin_resolve_emerging_category('curling', 'Curling', 'activities_recreation'); ok := false; exception when others then ok := true; end;
  assert ok, 'non-admin cannot resolve';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from admin_get_emerging_categories() where phrase_key like 'curling%';
  assert r.applicants = 4, format('curling flagged once with 4 businesses (got %s)', r.applicants);
  assert not exists (select 1 from admin_get_emerging_categories() where phrase_key like 'padel%'), 'padel (canonical) is never a candidate';
  assert not exists (select 1 from admin_get_emerging_categories() where phrase_key like 'tenni%'), 'tennis (canonical) is never a candidate';
  assert not exists (select 1 from admin_get_emerging_categories() where phrase_key like 'axe%'), 'axe throwing (2 businesses) is below the threshold';
  n := admin_resolve_emerging_category(r.phrase_key, 'Curling', 'activities_recreation');
  assert n = 5, format('all 5 curling applications mapped (got %s)', n);
  reset role;
  assert (select count(*) from business_partner_requests where subcategory = 'Curling' and category = 'activities_recreation') = 5, 'rows now Curling';
  assert (select count(*) from category_tag_groups where tag = 'Curling') = 1, 'tag created once';
  assert (select count(*) from category_taxonomy_changes c join category_tag_groups g on g.id = c.tag_id
           where g.tag = 'Curling' and c.change_type = 'added' and c.actor_id = admin_id) = 1, 'the add is in the taxonomy history';
  set local role authenticated;
  assert not exists (select 1 from admin_get_emerging_categories() where phrase_key like 'curling%'), 'curling no longer flagged';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform admin_dismiss_emerging_category('axe throwing');
  reset role;
  assert exists (select 1 from category_suggestion_dismissals where phrase_key = 'axe throwing'), 'dismissal recorded';
end $$;
select 'ALL OK' as result;
rollback;
