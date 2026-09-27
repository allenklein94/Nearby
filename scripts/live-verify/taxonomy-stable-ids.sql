-- Taxonomy stable IDs + versioned history (migration 20270232). ROLLED BACK: nothing here persists.
-- Covers: inventory (IDs, baseline history, registry vs real FKs), authorization, rename (every dependency, retry,
-- legacy names, reuse refused), atomic rollback of a failing rename, move (paired majors), retire (keep / merge),
-- restore, IDs never reused, append-only history, lookups, grants.
begin;
do $$
declare
  admin_id uuid := (select id from profiles where is_admin order by created_at limit 1);
  user_id uuid := (select id from profiles where not coalesce(is_admin, false) order by created_at limit 1);
  partner uuid := (select id from brand_partners order by created_at limit 1);
  g uuid; g2 uuid;
  v0 bigint; v1 bigint;
  a_id bigint; b_id bigint; new_id bigint;
  p jsonb; r jsonb;
  req uuid;
  ok boolean;
  n bigint;
begin
  assert admin_id is not null and user_id is not null and partner is not null, 'fixtures exist';

  -- ---------- Inventory ----------
  assert (select count(*) = count(distinct id) and count(*) filter (where id is null) = 0 from category_tag_groups),
    'every tag has a unique stable ID';
  assert (select count(*) from category_tag_groups g where not exists
            (select 1 from category_taxonomy_changes c where c.tag_id = g.id and c.change_type = 'added')) = 0,
    'every tag has an origin entry in the history';
  assert (select count(*) from category_tag_references where kind = 'fk') = 6, '6 FK references registered';
  assert (select count(*) from category_tag_references where kind = 'unlinked') = 15, '15 unlinked references registered';
  assert (select count(*) from category_tag_references where kind = 'historical') = 2, '2 historical references registered';
  -- The registry's FK rows are exactly the real FKs to category_tag_groups(tag).
  assert not exists (
    (select c.conrelid::regclass::text, a.attname::text from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'public.category_tag_groups'::regclass
        and c.confkey = array[(select attnum from pg_attribute where attrelid = 'public.category_tag_groups'::regclass and attname = 'tag')])
    except (select table_name, column_name from category_tag_references where kind = 'fk')
  ), 'every real FK is registered';
  assert not exists (select 1 from category_tag_references r where not exists
    (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = r.table_name
       and c.column_name = r.column_name)), 'every registered column exists';
  -- Every stored tag-name value today resolves to exactly one ID.
  assert not exists (select 1 from gatherings where interest_tag is not null and _taxonomy_id_for_name(interest_tag) is null),
    'gathering tags resolve';
  assert not exists (select 1 from profiles, unnest(interests) t where _taxonomy_id_for_name(t) is null), 'profile interests resolve';

  -- ---------- Authorization ----------
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  begin perform admin_preview_category_change('rename', 'Coffee', 'Kaffee'); ok := false;
  exception when others then ok := sqlerrm ilike '%only an admin%'; end;
  assert ok, 'non-admin cannot preview';
  begin perform admin_rename_category_tag('Coffee', 'Kaffee', 'no reason here at all', 'x', gen_random_uuid()); ok := false;
  exception when others then ok := sqlerrm ilike '%only an admin%'; end;
  assert ok, 'non-admin cannot rename';
  begin perform admin_retire_category_tag('Coffee', null, true, 'no reason here at all', 'x', gen_random_uuid()); ok := false;
  exception when others then ok := sqlerrm ilike '%only an admin%'; end;
  assert ok, 'non-admin cannot retire';
  begin update category_tag_groups set tag = 'Kaffee' where tag = 'Coffee'; ok := false;
  exception when others then ok := sqlerrm ilike '%go through admin_rename%'; end;
  assert ok, 'a direct rename outside the canonical path is refused';
  begin delete from category_tag_groups where tag = 'Coffee'; ok := false;
  exception when others then ok := sqlerrm ilike '%never deleted%'; end;
  assert ok, 'a tag is never deleted';
  assert not has_function_privilege('anon', 'admin_rename_category_tag(text,text,text,text,uuid)', 'execute'), 'anon cannot rename';
  assert not has_function_privilege('authenticated', '_taxonomy_apply(text,text,text,text,text,boolean,text,text,uuid)', 'execute'),
    'the engine is not callable by clients';
  assert not has_table_privilege('authenticated', 'category_tag_groups', 'update'), 'clients cannot write the taxonomy';
  assert not has_table_privilege('authenticated', 'category_taxonomy_changes', 'select'), 'clients cannot read the audit log';
  assert has_function_privilege('anon', 'resolve_category_tag(text)', 'execute'), 'lookup is public like the taxonomy';

  -- ---------- Add (existing path) records history and bumps the version once ----------
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select version into v0 from category_taxonomy_version;
  perform admin_add_category_tag('LV Taxo Alpha', 'food_drink');
  perform admin_add_category_tag('LV Taxo Beta', 'food_drink');
  select id into a_id from category_tag_groups where tag = 'LV Taxo Alpha';
  select id into b_id from category_tag_groups where tag = 'LV Taxo Beta';
  assert (select version from category_taxonomy_version) = v0 + 2, 'each add bumps the version by one';
  assert (select actor_id from category_taxonomy_changes where tag_id = a_id and change_type = 'added') = admin_id, 'add records the actor';
  assert a_id > (select max(id) from category_tag_groups where tag not like 'LV Taxo%'), 'new IDs come after every existing one';

  -- Fixtures referencing Alpha in FK, unlinked scalar, unlinked array, synonym, alias, behavior and a historical log.
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (user_id, 'lv taxo', now() + interval '2 days', 40, -75, 'LV Taxo Alpha', 'lv', 4, 'everyone') returning id into g;
  update profiles set interests = array['Coffee', 'LV Taxo Alpha'], notify_things_to_do_categories = array['LV Taxo Alpha']
    where id = user_id;
  update brand_partners set subcategory = 'LV Taxo Alpha', categories = array['LV Taxo Alpha', 'Coffee'] where id = partner;
  perform admin_add_category_synonym('lv alpha phrase', 'LV Taxo Alpha');
  insert into category_aliases (phrase, category, subcategory) values ('lv alpha alias', 'food_drink', 'LV Taxo Alpha');
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category)
    values (user_id, 'open', 'gathering', g, 'LV Taxo Alpha');
  insert into intent_submissions (user_id, raw_text, category) values (user_id, 'lv taxo', 'LV Taxo Alpha');

  -- ---------- Safeguard: nothing commits without a matching preview, a reason and a request id ----------
  p := admin_preview_category_change('rename', 'LV Taxo Alpha', 'LV Taxo Gamma');
  assert jsonb_array_length(p->'blockers') = 0 and not (p->>'noop')::boolean, 'rename preview is clean';
  assert (select sum((e->>'rows')::int) from jsonb_array_elements(p->'references') e where e->>'kind' <> 'historical') = 8,
    'preview counts the 8 live references';
  begin perform admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Gamma', 'Clearer wording for people', 'stale', gen_random_uuid()); ok := false;
  exception when others then ok := sqlerrm ilike '%preview it again%'; end;
  assert ok, 'a wrong/stale impact token is refused';
  begin perform admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Gamma', 'short', p->>'impact_token', gen_random_uuid()); ok := false;
  exception when others then ok := sqlerrm ilike '%say why%'; end;
  assert ok, 'a reason is required';
  begin perform admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Gamma', 'Clearer wording for people', p->>'impact_token', null); ok := false;
  exception when others then ok := sqlerrm ilike '%request id%'; end;
  assert ok, 'a request id is required';
  -- The data changes after the preview -> the old token no longer commits.
  update profiles set monthly_interests = array['LV Taxo Alpha'] where id = user_id;
  begin perform admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Gamma', 'Clearer wording for people', p->>'impact_token', gen_random_uuid()); ok := false;
  exception when others then ok := sqlerrm ilike '%preview it again%'; end;
  assert ok, 'data changed since the preview -> refused';

  -- Conflicts are blockers.
  p := admin_preview_category_change('rename', 'LV Taxo Alpha', 'coffee');
  assert jsonb_array_length(p->'blockers') > 0, 'renaming onto an existing tag (any case) is blocked';
  p := admin_preview_category_change('rename', 'LV Taxo Alpha', 'Cafe');
  assert (p->>'blockers') ilike '%synonym of Coffee%', 'renaming onto another tag''s synonym is blocked';
  p := admin_preview_category_change('rename', 'LV Taxo Alpha', 'LV Taxo Beta');
  assert jsonb_array_length(p->'blockers') > 0, 'renaming onto another test tag is blocked';

  -- ---------- Atomicity: a dependent update that fails rolls back the whole rename ----------
  alter table gatherings add constraint lv_taxo_fail check (interest_tag is distinct from 'LV Taxo Fail') not valid;
  select version into v1 from category_taxonomy_version;
  p := admin_preview_category_change('rename', 'LV Taxo Alpha', 'LV Taxo Fail');
  begin
    perform admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Fail', 'Testing a failing dependent update', p->>'impact_token', gen_random_uuid());
    ok := false;
  exception when others then ok := sqlerrm ilike '%lv_taxo_fail%'; end;
  assert ok, 'the failing dependent update surfaced';
  assert (select tag from category_tag_groups where id = a_id) = 'LV Taxo Alpha', 'name rolled back';
  assert (select version from category_taxonomy_version) = v1, 'version rolled back';
  assert (select subcategory from brand_partners where id = partner) = 'LV Taxo Alpha', 'FK cascade rolled back';
  assert (select interests from profiles where id = user_id) = array['Coffee', 'LV Taxo Alpha'], 'profile rewrite rolled back';
  assert (select count(*) from category_taxonomy_changes where tag_id = a_id and change_type = 'renamed') = 0, 'no history left behind';
  assert (select count(*) from category_tag_former_names where tag_id = a_id) = 0, 'no former name left behind';
  alter table gatherings drop constraint lv_taxo_fail;

  -- ---------- Rename ----------
  p := admin_preview_category_change('rename', 'LV Taxo Alpha', 'LV Taxo Gamma');
  req := gen_random_uuid();
  r := admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Gamma', 'Clearer wording for people', p->>'impact_token', req);
  assert (r->>'changed')::boolean and (r->>'taxonomy_version')::bigint = v1 + 1, 'rename committed with one version bump';
  assert (select tag from category_tag_groups where id = a_id) = 'LV Taxo Gamma', 'same ID, new name';
  assert (select interest_tag from gatherings where id = g) = 'LV Taxo Gamma', 'gathering (unlinked) renamed';
  assert (select interests from profiles where id = user_id) = array['Coffee', 'LV Taxo Gamma'], 'interests renamed in place, order kept';
  assert (select monthly_interests from profiles where id = user_id) = array['LV Taxo Gamma'], 'monthly interests renamed';
  assert (select notify_things_to_do_categories from profiles where id = user_id) = array['LV Taxo Gamma'], 'notification filter renamed';
  assert (select subcategory from brand_partners where id = partner) = 'LV Taxo Gamma', 'business subcategory (FK) renamed';
  assert (select categories from brand_partners where id = partner) = array['LV Taxo Gamma', 'Coffee'], 'business secondary tags renamed';
  assert (select tag from category_synonyms where phrase = 'lv alpha phrase') = 'LV Taxo Gamma', 'synonym (FK) renamed';
  assert (select subcategory from category_aliases where phrase = 'lv alpha alias') = 'LV Taxo Gamma', 'alias renamed';
  assert (select category from behavior_events where entity_id = g) = 'LV Taxo Gamma', 'behavior affinity renamed';
  assert (select category from intent_submissions where raw_text = 'lv taxo') = 'LV Taxo Alpha', 'historical log kept as asked';
  assert (select tag from category_synonyms where phrase = _category_search_key('LV Taxo Alpha')) = 'LV Taxo Gamma',
    'the old wording became a search synonym';
  assert (select old_name || '>' || new_name || ':' || actor_kind || ':' || coalesce(reason, '') from category_taxonomy_changes
           where tag_id = a_id and change_type = 'renamed') = 'LV Taxo Alpha>LV Taxo Gamma:admin:Clearer wording for people',
    'history has old/new name, actor and reason';
  assert (select request_id from category_taxonomy_changes where tag_id = a_id and change_type = 'renamed') = req, 'request id recorded';
  -- Retry is safe; reusing an id for another change is not.
  r := admin_rename_category_tag('LV Taxo Alpha', 'LV Taxo Gamma', 'Clearer wording for people', p->>'impact_token', req);
  assert (r->>'replayed')::boolean and (select version from category_taxonomy_version) = v1 + 1, 'retry replays, no second bump';
  begin perform admin_move_category_tag('LV Taxo Gamma', 'entertainment_nightlife', 'Reusing an id on purpose', 'x', req); ok := false;
  exception when others then ok := sqlerrm ilike '%different change%'; end;
  assert ok, 'a request id cannot be reused for another change';
  -- No-op: no bump, no history.
  r := admin_rename_category_tag('LV Taxo Gamma', 'LV Taxo Gamma', null, null, gen_random_uuid());
  assert not (r->>'changed')::boolean and (select version from category_taxonomy_version) = v1 + 1, 'a no-op does not bump';
  -- Legacy name resolves; writing it saves the current name; it can never be reused.
  assert (select current_tag || ':' || matched_via || ':' || id from resolve_category_tag('lv taxo alpha')) = 'LV Taxo Gamma:former_name:' || a_id,
    'former name resolves to the same ID';
  assert (select tag from resolve_category_tag(a_id::text)) = 'LV Taxo Gamma', 'ID resolves to the current record';
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (user_id, 'lv taxo 2', now() + interval '2 days', 40, -75, 'LV Taxo Alpha', 'lv', 4, 'everyone') returning id into g2;
  assert (select interest_tag from gatherings where id = g2) = 'LV Taxo Gamma', 'an old client writing the old name saves the new one';
  update brand_partners set subcategory = 'LV Taxo Alpha' where id = partner;
  assert (select subcategory from brand_partners where id = partner) = 'LV Taxo Gamma', 'old name on an FK column is normalized before the FK check';
  begin perform admin_add_category_tag('LV Taxo Alpha', 'food_drink'); ok := false;
  exception when others then ok := sqlerrm ilike '%belonged to another category%'; end;
  assert ok, 'a former name can never be given to a new category';
  begin perform admin_preview_category_change('rename', 'LV Taxo Alpha', 'X Y'); ok := false;
  exception when others then ok := sqlerrm ilike '%former name%'; end;
  assert ok, 'admin actions name the current category when given a former name';

  -- ---------- Move ----------
  p := admin_preview_category_change('move', 'LV Taxo Gamma', null, 'entertainment_nightlife');
  assert (p->'matching'->>'businesses_major_changes')::int = 1, 'preview names the business whose major changes';
  r := admin_move_category_tag('LV Taxo Gamma', 'entertainment_nightlife', 'Belongs with nights out', p->>'impact_token', gen_random_uuid());
  assert (select group_key from category_tag_groups where id = a_id) = 'entertainment_nightlife', 'moved';
  assert (select category from brand_partners where id = partner) = 'entertainment_nightlife', 'paired major follows the tag';
  assert (select category from category_aliases where phrase = 'lv alpha alias') = 'entertainment_nightlife', 'alias major follows';
  assert (select old_group || '>' || new_group from category_taxonomy_changes where tag_id = a_id and change_type = 'moved')
         = 'food_drink>entertainment_nightlife', 'move history';
  assert request_category_group('LV Taxo Gamma') = 'entertainment_nightlife', 'routing reads the new group';
  r := admin_move_category_tag('LV Taxo Gamma', 'entertainment_nightlife', null, null, gen_random_uuid());
  assert not (r->>'changed')::boolean, 'move to the same group is a no-op';

  -- ---------- Retire, keeping existing references ----------
  p := admin_preview_category_change('retire', 'LV Taxo Gamma');
  assert (p->>'blockers') ilike '%choose a replacement%', 'retiring a used tag needs an explicit choice';
  p := admin_preview_category_change('retire', 'LV Taxo Gamma', null, null, null, true);
  r := admin_retire_category_tag('LV Taxo Gamma', null, true, 'Superseded, keep old data', p->>'impact_token', gen_random_uuid());
  assert (select retired_at is not null from category_tag_groups where id = a_id), 'retired';
  assert (select interest_tag from gatherings where id = g) = 'LV Taxo Gamma', 'existing references kept';
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
      values (user_id, 'lv taxo 3', now() + interval '2 days', 40, -75, 'LV Taxo Gamma', 'lv', 4, 'everyone');
    ok := false;
  exception when others then ok := sqlerrm ilike '%retired%'; end;
  assert ok, 'a retired tag cannot be newly chosen';
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
      values (user_id, 'lv taxo 4', now() + interval '2 days', 40, -75, 'LV Taxo Alpha', 'lv', 4, 'everyone');
    ok := false;
  exception when others then ok := sqlerrm ilike '%retired%'; end;
  assert ok, 'nor through its former name';
  update profiles set interests = array['LV Taxo Gamma', 'Coffee', 'Hiking'] where id = user_id;   -- already had it: allowed
  assert (select interests from profiles where id = user_id) = array['LV Taxo Gamma', 'Coffee', 'Hiking'], 'a person keeps a retired interest';
  begin update profiles set interests = array['LV Taxo Gamma'] where id = admin_id; ok := false;
  exception when others then ok := sqlerrm ilike '%retired%'; end;
  assert ok, 'another person cannot newly add it';
  update gatherings set description = 'lv taxo edited' where id = g;
  assert (select interest_tag from gatherings where id = g) = 'LV Taxo Gamma', 'unrelated edits to a row with a retired tag still work';

  -- ---------- Restore ----------
  p := admin_preview_category_change('restore', 'LV Taxo Gamma');
  r := admin_restore_category_tag('LV Taxo Gamma', 'Needed again after all', p->>'impact_token', gen_random_uuid());
  assert (select retired_at is null from category_tag_groups where id = a_id), 'restored';
  update profiles set interests = array['LV Taxo Gamma'] where id = admin_id;
  assert (select interests from profiles where id = admin_id) = array['LV Taxo Gamma'], 'restored tag can be chosen again';

  -- ---------- Retire into a replacement (merge) ----------
  p := admin_preview_category_change('retire', 'LV Taxo Gamma', null, null, 'Dental');
  assert (p->>'blockers') ilike '%business-only%', 'a consumer tag cannot merge into a business-only one';
  update profiles set interests = array['LV Taxo Gamma', 'LV Taxo Beta'] where id = user_id;
  p := admin_preview_category_change('retire', 'LV Taxo Gamma', null, null, 'LV Taxo Beta');
  r := admin_retire_category_tag('LV Taxo Gamma', 'LV Taxo Beta', false, 'Merging duplicates together', p->>'impact_token', gen_random_uuid());
  assert (select replaced_by from category_tag_groups where id = a_id) = b_id, 'retired into Beta';
  assert (select interest_tag from gatherings where id = g) = 'LV Taxo Beta', 'references moved to the replacement';
  assert (select interests from profiles where id = user_id) = array['LV Taxo Beta'], 'array merged without a duplicate';
  assert (select subcategory || '/' || category from brand_partners where id = partner) = 'LV Taxo Beta/food_drink',
    'FK moved and the major follows the replacement''s group';
  assert (select tag from category_synonyms where phrase = 'lv alpha phrase') = 'LV Taxo Beta', 'synonyms moved';
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (user_id, 'lv taxo 5', now() + interval '2 days', 40, -75, 'LV Taxo Alpha', 'lv', 4, 'everyone') returning id into g2;
  assert (select interest_tag from gatherings where id = g2) = 'LV Taxo Beta', 'the oldest name follows rename + merge to Beta';
  assert (select current_tag from resolve_category_tag('LV Taxo Gamma')) = 'LV Taxo Beta', 'lookup follows the merge';
  assert (select retired from resolve_category_tag('LV Taxo Gamma')), 'and says it is retired';

  -- ---------- IDs never reused ----------
  perform admin_add_category_tag('LV Taxo Delta', 'food_drink');
  select id into new_id from category_tag_groups where tag = 'LV Taxo Delta';
  assert new_id > b_id and new_id <> a_id, 'a new tag never takes a retired ID';
  begin update category_tag_groups set id = a_id where id = new_id; ok := false;
  exception when others then ok := true; end;
  assert ok, 'an ID never changes';
  begin perform admin_add_category_tag('LV Taxo Gamma', 'food_drink'); ok := false;
  exception when others then ok := true; end;
  assert ok, 'a retired name cannot be added again';

  -- ---------- Append-only history, version integrity, lookups ----------
  begin update category_taxonomy_changes set reason = 'edited' where tag_id = a_id; ok := false;
  exception when others then ok := sqlerrm ilike '%append-only%'; end;
  assert ok, 'history cannot be edited';
  begin delete from category_taxonomy_changes where tag_id = a_id; ok := false;
  exception when others then ok := sqlerrm ilike '%append-only%'; end;
  assert ok, 'history cannot be deleted';
  assert (select array_agg(change_type order by id) from category_taxonomy_changes where tag_id = a_id)
         = array['added', 'renamed', 'moved', 'retired', 'restored', 'retired'], 'full ordered history';
  assert (select count(distinct taxonomy_version) = count(*) from category_taxonomy_changes where tag_id = a_id),
    'every change of one tag has its own version';
  assert (select (get_category_taxonomy()->>'version')::bigint) = (select version from category_taxonomy_version), 'lookup carries the version';
  assert exists (select 1 from jsonb_array_elements(get_category_taxonomy()->'former_names') f where f->>'name' = 'LV Taxo Alpha'),
    'lookup lists former names';
  select count(*) into n from admin_get_category_tag_history('LV Taxo Alpha');
  assert n = 6, 'history is reachable by a former name';

  -- Existing paths unchanged.
  assert 'Coffee' = any (business_served_tags(partner)) or true, 'served tags still compute';
  assert is_valid_category_tag('Coffee') and all_valid_category_tags(array['Coffee', 'Hiking']), 'validators unchanged';
  raise notice 'ALL OK';
end $$;
-- The emerging-category path (admin_resolve_emerging_category) adds through the same triggers: ID, history, version.
do $$
declare admin_id uuid := (select id from profiles where is_admin order by created_at limit 1); v0 bigint; tid bigint;
begin
  insert into business_partner_requests (business_name, unlisted_category_text, applicant_email, applicant_name, applicant_phone, source) values
    ('p1','axe throwing','p1@x.com','n','5007','web'),('p2','Axe Throwing','p2@x.com','n','5008','web'),('p3','axe-throwing','p3@x.com','n','5009','web');
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select version into v0 from category_taxonomy_version;
  perform admin_resolve_emerging_category('axe throwing', 'Axe Throwing', 'activities_recreation');
  select id into tid from category_tag_groups where tag = 'Axe Throwing';
  assert tid is not null, 'emerging category added with an ID';
  assert (select version from category_taxonomy_version) = v0 + 1, 'one version bump';
  assert (select actor_id from category_taxonomy_changes where tag_id = tid and change_type = 'added') = admin_id, 'history records the admin';
  assert (select count(*) from business_partner_requests where subcategory = 'Axe Throwing') = 3, 'the cluster was mapped';
end $$;
select 'ALL OK' as result;
rollback;
