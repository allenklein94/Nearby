-- Item 168 V1 category pass (migration 20270294). ROLLED BACK: nothing here persists.
-- After the migration is applied: run this file as is. Before (dry run): run the migration and this file inside ONE
-- transaction, e.g. `{ echo 'begin;'; cat supabase/migrations/20270294_v1_category_pass.sql; sed '/^begin;$/d' this-file; }`.
-- Covers: groups and sizes, Stay & Getaway gone everywhere, customer-only (primary, secondary, posting, boost, web signup
-- table, dashboard RPC), max 5 secondary (insert, growth, an old row's unrelated edit), group-only routing (no retired or
-- customer-only tag), the dashboard RPC's group list, the public snapshot, the league format, audit history.
begin;
do $$
declare
  mgr uuid := (select id from profiles where managed_partner_id is not null order by created_at limit 1);
  partner uuid := (select managed_partner_id from profiles where id = mgr);
  b uuid;
  served text[];
  snap jsonb;
begin
  -- Groups
  assert cardinality(category_major_keys()) = 19, '19 groups';
  assert 'sports_fitness' = any (category_major_keys()) and not ('stay_getaway' = any (category_major_keys())), 'sports_fitness in, stay_getaway out';
  assert (select count(*) from category_tag_groups where retired_at is null and group_key = 'sports_fitness') = 19, 'Sports & Fitness has 19';
  assert (select count(*) from category_tag_groups where retired_at is null and group_key = 'activities_recreation') = 11, 'Activities has 11';
  assert (select count(*) from category_tag_groups where retired_at is null and group_key = 'travel_experiences') = 17, 'Travel & Getaways has 17';
  assert (select count(*) from category_tag_groups where group_key = 'stay_getaway') = 0, 'no row (live or retired) keeps stay_getaway';
  assert (select group_key from category_tag_groups where tag = 'Kids Sports') = 'family_kids', 'Kids Sports stays in Family & Kids';
  assert (select group_key from category_tag_groups where tag = 'Boating') = 'outdoors_nature', 'Boating moved to Outdoors';
  assert (select retired_at is not null from category_tag_groups where tag = 'Pet Friendly Places'), 'Pet Friendly Places retired';
  assert not exists (select 1 from category_tag_groups where lower(tag) = 'locksmith'), 'Locksmith not created';
  -- Audit: every change is in the history, made by the migration
  assert (select count(*) from category_taxonomy_changes where change_type = 'moved' and reason like 'Item 168%') = 31, '31 audited moves';
  assert (select count(*) from category_taxonomy_changes where change_type = 'customer_only_changed') = 7, '7 audited customer-only flags';
  assert not exists (select 1 from category_taxonomy_changes where reason like 'Item 168%' and actor_kind <> 'migration'), 'actor = migration';

  -- Stay & Getaway is refused as a stored group
  begin
    update brand_partners set category = 'stay_getaway' where id = partner;
    raise exception 'stay_getaway was accepted';
  exception when check_violation then if sqlerrm not like '%brand_partners_category_check%' then raise; end if; end;

  -- Customer-only: refused as primary, secondary, posting and boost; Speed Dating stays business-selectable
  begin
    insert into business_partner_requests (source, applicant_name, applicant_email, applicant_phone, business_name, category, subcategory) values ('web', 'V1', 'v1@example.com', '5555550101', 'V1 test', 'dating_social', 'Date Night');
    raise exception 'customer-only primary accepted';
  exception when check_violation then if sqlerrm <> 'That category is for people, not businesses.' then raise; end if; end;
  begin
    insert into business_partner_requests (source, applicant_name, applicant_email, applicant_phone, business_name, category, categories) values ('web', 'V1', 'v1@example.com', '5555550102', 'V1 test', 'food_drink', array['First Date']);
    raise exception 'customer-only secondary accepted';
  exception when check_violation then if sqlerrm <> 'That category is for people, not businesses.' then raise; end if; end;
  begin
    insert into business_availability (partner_id, title, starts_at, ends_at, category) values (partner, 'V1', now(), now() + interval '1 hour', 'Date Night');
    raise exception 'customer-only posting accepted';
  exception when check_violation then if sqlerrm <> 'That category is for people, not businesses.' then raise; end if; end;
  begin
    insert into business_priority_signals (partner_id, category, expires_at) values (partner, 'Couples', now() + interval '1 day');
    raise exception 'customer-only boost accepted';
  exception when check_violation then if sqlerrm <> 'That category is for people, not businesses.' then raise; end if; end;
  insert into business_partner_requests (source, applicant_name, applicant_email, applicant_phone, business_name, category, subcategory) values ('web', 'V1', 'v1@example.com', '5555550103', 'V1 test ok', 'dating_social', 'Speed Dating');

  -- Max 5 secondary: 5 ok, 6 refused, an old row over the cap can still be edited or shrink, never grow
  insert into business_partner_requests (source, applicant_name, applicant_email, applicant_phone, business_name, category, subcategory, categories)
    values ('web', 'V1', 'v1@example.com', '5555550104', 'V1 five', 'food_drink', 'Coffee', array['Tea', 'Breakfast', 'Brunch', 'Pastries', 'Bakeries', 'Coffee']); -- the primary does not count
  begin
    insert into business_partner_requests (source, applicant_name, applicant_email, applicant_phone, business_name, category, categories) values ('web', 'V1', 'v1@example.com', '5555550105', 'V1 six', 'food_drink', array['Tea', 'Breakfast', 'Brunch', 'Pastries', 'Bakeries', 'Wine']);
    raise exception 'six secondary accepted';
  exception when check_violation then if sqlerrm <> 'A business can add up to 5 more categories.' then raise; end if; end;
  alter table brand_partners disable trigger enforce_business_category_rules;
  insert into brand_partners (name, category, categories) values ('V1 legacy seven', 'food_drink', array['Tea', 'Breakfast', 'Brunch', 'Pastries', 'Bakeries', 'Wine', 'Wineries']) returning id into b;
  alter table brand_partners enable trigger enforce_business_category_rules;
  update brand_partners set description = 'unrelated edit' where id = b;                                   -- allowed
  update brand_partners set categories = array['Tea', 'Breakfast', 'Brunch', 'Pastries', 'Bakeries', 'Wine'] where id = b; -- shrinking: allowed
  begin
    update brand_partners set categories = categories || array['Coffee'] where id = b;
    raise exception 'growing past five accepted';
  exception when check_violation then if sqlerrm <> 'A business can add up to 5 more categories.' then raise; end if; end;

  -- Group-only routing: live, business-selectable tags of the group only
  insert into brand_partners (name, category) values ('V1 group-only dating', 'dating_social') returning id into b;
  served := business_served_tags(b);
  assert 'Speed Dating' = any (served) and 'Social Clubs' = any (served) and not ('Date Night' = any (served)) and cardinality(served) = 3, 'dating group-only serves the 3 business tags: ' || served::text;
  insert into brand_partners (name, category) values ('V1 group-only sports', 'sports_fitness') returning id into b;
  served := business_served_tags(b);
  assert cardinality(served) = 19 and 'Personal Training' = any (served), 'sports group-only serves 19';
  insert into brand_partners (name, category) values ('V1 group-only pets', 'pets') returning id into b;
  assert not ('Pet Friendly Places' = any (business_served_tags(b))) and 'Pet Sitting' = any (business_served_tags(b)), 'pets group-only: no retired tag, has Pet Sitting';
  insert into brand_partners (name, category) values ('V1 group-only activities', 'activities_recreation') returning id into b;
  served := business_served_tags(b);
  assert not ('Yoga' = any (served)) and 'Go-Karts' = any (served) and cardinality(served) = 11, 'activities group-only serves its 11';

  -- The dashboard RPC: the new group and a moved primary tag save; the old group and a customer-only primary are refused
  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  perform update_business_profile(partner, 'Coastal Coffee', null, null, null, null, null, 'sports_fitness', null, null, null, 'Yoga', array['Tea']);
  assert (select category = 'sports_fitness' and subcategory = 'Yoga' from brand_partners where id = partner), 'moved primary saves';
  begin
    perform update_business_profile(partner, 'Coastal Coffee', null, null, null, null, null, 'stay_getaway', null, null, null, null, null);
    raise exception 'stay_getaway accepted by the RPC';
  exception when raise_exception then
    if sqlerrm not like 'Invalid category%' then raise; end if;
  end;
  begin
    perform update_business_profile(partner, 'Coastal Coffee', null, null, null, null, null, 'dating_social', null, null, null, 'First Date', null);
    raise exception 'customer-only primary accepted by the RPC';
  exception when raise_exception then
    if sqlerrm not like 'Invalid subcategory%' then raise; end if;
  end;
  begin
    perform update_business_profile(partner, 'Coastal Coffee', null, null, null, null, null, 'food_drink', null, null, null, 'Coffee',
                                    array['Tea', 'Breakfast', 'Brunch', 'Pastries', 'Bakeries', 'Wine']);
    raise exception 'six secondary accepted by the RPC';
  exception when check_violation then if sqlerrm <> 'A business can add up to 5 more categories.' then raise; end if; end;
  assert (select count(*) from pg_proc where proname = 'update_business_profile') = 1, 'single overload';

  -- Public snapshot carries the flag; the app hydrates it
  snap := get_category_taxonomy();
  assert exists (select 1 from jsonb_array_elements(snap->'tags') t where t->>'tag' = 'Date Night' and (t->>'customer_only')::boolean), 'snapshot: Date Night customer-only';
  assert exists (select 1 from jsonb_array_elements(snap->'tags') t where t->>'tag' = 'Speed Dating' and not (t->>'customer_only')::boolean), 'snapshot: Speed Dating business-selectable';

  -- League format accepted
  assert pg_get_constraintdef((select oid from pg_constraint where conname = 'gatherings_format_check')) like '%league%', 'league format';
end $$;
select 'ALL OK' as result;
rollback;
