-- Synonyms as data (20270191). ROLLED BACK. Rewritten 2026-09-27: the original resolved "padel" as an emerging
-- category, but Padel became canonical on 2026-09-26 (20270213). Now "curling" (not a tag/synonym/alias) is resolved, and
-- the current Padel state is asserted: its synonyms are readable and a canonical name can never be taught as another's synonym.
begin;
do $$
declare admin_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid(); ok boolean; k text;
begin
  assert not exists (select 1 from category_tag_groups where _category_search_key(tag) = 'curling'), 'precondition: curling is not a category';
  insert into auth.users (id) values (admin_id), (other_id);
  perform set_config('app.trusted_update', 'true', true);
  insert into profiles (id, is_admin, display_name, birthdate) values (admin_id, false, 'Admin', '1990-01-01'), (other_id, false, 'Other', '1990-01-01');
  update profiles set is_admin = true where id = admin_id;
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('a','Curling rink','a@x.com','n','7001','web'),('b','curling club','b@x.com','n','7002','web'),
    ('c','Curling lessons','c@x.com','n','7003','web'),('d','curling','d@x.com','n','7004','web');

  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform admin_add_category_synonym('cafe latte', 'Coffee'); ok := false; exception when others then ok := sqlerrm ilike '%admin%'; end;
  assert ok, 'non-admin cannot add a synonym';
  assert (select count(*) from get_category_synonyms()) > 100, 'signed-in people can read the synonym list';
  assert exists (select 1 from get_category_synonyms() where tag = 'Padel'), 'Padel''s synonyms are readable (current state)';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform admin_add_category_synonym('xx', 'No Such Tag'); ok := false; exception when others then ok := sqlerrm ilike '%unknown%'; end;
  assert ok, 'unknown tag refused';
  begin perform admin_add_category_synonym('padel', 'Tennis'); ok := false; exception when others then ok := sqlerrm ilike '%already its own category%'; end;
  assert ok, 'a canonical name (Padel) can never become another category''s synonym';
  k := admin_add_category_synonym('Cafe  Latte!', 'Coffee');
  assert k = 'cafe latte', format('synonym normalized (got %s)', k);
  perform admin_resolve_emerging_category('curling', 'Curling', 'activities_recreation');
  assert exists (select 1 from get_category_synonyms() where tag = 'Curling' and phrase = 'curling rink'), 'a business wording became a synonym';
  assert exists (select 1 from get_category_synonyms() where tag = 'Curling' and phrase = 'curling lesson'), 'every wording in the cluster is taught';
  reset role;
end $$;
select 'ALL OK' as result;
rollback;
