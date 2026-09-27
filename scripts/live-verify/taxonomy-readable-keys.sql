-- Readable immutable category keys (migration 20270234). ROLLED BACK; runs on prod or a replay database.
-- Every category has exactly one unique key; a rename keeps id AND key; the old name still resolves to the same id;
-- a key is never reused (not even a retired one) and never edited; a failed rename leaves id, key, name, synonyms and
-- stored references exactly as they were.
begin;
do $$
declare
  admin_id uuid := (select id from profiles where is_admin order by created_at limit 1);
  g_id uuid := (select id from gatherings order by created_at limit 1);
  a_id bigint; a_key text; p jsonb; r jsonb; ok boolean; n int; v1 bigint;
  syn_before text;
begin
  -- 1-2. exactly one key per category, unique, lowercase format
  assert (select count(*) from category_tag_groups where key is null) = 0, 'every category has a key';
  assert (select count(distinct key) from category_tag_groups) = (select count(*) from category_tag_groups), 'keys are unique';
  assert (select count(*) from category_tag_groups where key !~ '^[a-z0-9]+(_[a-z0-9]+)*$') = 0, 'keys are lowercase snake case';
  assert (select key from category_tag_groups where tag = 'Coffee') = 'coffee', 'Coffee -> coffee';
  assert (select key from category_tag_groups where tag = 'Live Music') = 'live_music', 'Live Music -> live_music';
  assert (select key from category_tag_groups where tag = 'Dessert & Ice Cream') = 'dessert_and_ice_cream', '& -> and';
  assert (select key from category_tag_groups where tag = 'Self-Care') = 'self_care', 'punctuation -> underscore';
  assert exists (select 1 from jsonb_array_elements(get_category_taxonomy()->'tags') t
                 where t->>'tag' = 'Coffee' and t->>'key' = 'coffee' and (t->>'id')::bigint = 42), 'snapshot carries id + key';

  -- A key is never edited directly, not even by the database owner.
  begin update category_tag_groups set key = 'coffee_and_cafes' where tag = 'Coffee'; ok := false;
  exception when others then ok := sqlerrm ilike '%key never changes%'; end;
  assert ok, 'a key cannot be changed';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform admin_add_category_tag('LV Key Alpha', 'food_drink');
  select id, key into a_id, a_key from category_tag_groups where tag = 'LV Key Alpha';
  assert a_key = 'lv_key_alpha', 'a new category gets its key from its name at creation';
  update gatherings set interest_tag = 'LV Key Alpha' where id = g_id;

  -- 6. a failed rename leaves everything unchanged
  select string_agg(phrase || '>' || tag, ',' order by phrase) into syn_before from get_category_synonyms() where tag like 'LV Key%';
  select version into v1 from category_taxonomy_version;
  alter table gatherings add constraint lv_key_fail check (interest_tag is distinct from 'LV Key Fail') not valid;
  p := admin_preview_category_change('rename', 'LV Key Alpha', 'LV Key Fail');
  begin
    perform admin_rename_category_tag('LV Key Alpha', 'LV Key Fail', 'Testing a failing dependent update', p->>'impact_token', gen_random_uuid());
    ok := false;
  exception when others then ok := sqlerrm ilike '%lv_key_fail%'; end;
  assert ok, 'the failing dependent update surfaced';
  assert (select (id, key, tag) = (a_id, a_key, 'LV Key Alpha') from category_tag_groups where id = a_id), 'id, key, name unchanged';
  assert (select interest_tag from gatherings where id = g_id) = 'LV Key Alpha', 'stored reference unchanged';
  assert (select string_agg(phrase || '>' || tag, ',' order by phrase) from get_category_synonyms() where tag like 'LV Key%')
         is not distinct from syn_before, 'synonyms unchanged';
  assert (select version from category_taxonomy_version) = v1, 'version unchanged';
  assert not exists (select 1 from category_tag_former_names where tag_id = a_id), 'no former name left behind';
  alter table gatherings drop constraint lv_key_fail;

  -- 3-4. rename keeps id AND key; the old name resolves to the same id and is a synonym
  p := admin_preview_category_change('rename', 'LV Key Alpha', 'LV Key Alpha & Cafes');
  r := admin_rename_category_tag('LV Key Alpha', 'LV Key Alpha & Cafes', 'Broader name for the same thing', p->>'impact_token', gen_random_uuid());
  assert (r->>'changed')::boolean, 'renamed';
  assert (select (id, key) = (a_id, 'lv_key_alpha') from category_tag_groups where tag = 'LV Key Alpha & Cafes'), 'id and key survive the rename';
  assert not exists (select 1 from category_tag_groups where key = 'lv_key_alpha_and_cafes'), 'no new key was generated';
  assert (select interest_tag from gatherings where id = g_id) = 'LV Key Alpha & Cafes', 'stored reference rewritten';
  assert _taxonomy_id_for_name('LV Key Alpha') = a_id, 'old name resolves to the same id';
  assert exists (select 1 from get_category_synonyms() where tag = 'LV Key Alpha & Cafes' and phrase = _category_search_key('LV Key Alpha')),
    'old name is a synonym of the renamed category';

  -- 5. a retired key is never reused
  update gatherings set interest_tag = null where id = g_id;
  p := admin_preview_category_change('retire', 'LV Key Alpha & Cafes', null, null, null, true);
  r := admin_retire_category_tag('LV Key Alpha & Cafes', null, true, 'Testing key reuse after retirement', p->>'impact_token', gen_random_uuid());
  assert (select retired_at is not null and key = 'lv_key_alpha' from category_tag_groups where id = a_id), 'retired, key kept';
  begin insert into category_tag_groups (tag, group_key, key) values ('LV Key Other', 'food_drink', 'lv_key_alpha'); ok := false;
  exception when others then ok := sqlerrm ilike '%already taken%'; end;
  assert ok, 'an explicit retired key is refused';
  insert into category_tag_groups (tag, group_key) values ('LV_Key_Alpha', 'food_drink');   -- name derives the retired key
  assert (select key from category_tag_groups where tag = 'LV_Key_Alpha') <> 'lv_key_alpha', 'a derived collision never reuses the key';
  assert (select key from category_tag_groups where tag = 'LV_Key_Alpha') like 'lv_key_alpha_category_%', 'collision gets the permanent id appended';
end $$;
select 'ALL OK' as result;
rollback;
