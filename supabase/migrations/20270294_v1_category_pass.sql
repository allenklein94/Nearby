-- Item 168: the V1 category pass (owner items 168-186, LOCKED; owner decisions D1-D6 approved 2026-10-11).
-- ONE structural pass: no ranking, routing, eligibility, matching, privacy or business-demand rule changes here.
-- Mapping, impact and checklist: PRODUCT_AUDIT/ITEM_168_MIGRATION_PREP_2026-10-11.md (+ item168_prep/mapping.json; the lists
-- below are generated from it and checked by PRODUCT_AUDIT/item168_prep/crosscheck.js). Runbook + rollback:
-- PRODUCT_AUDIT/ITEM_168_MIGRATION_RUNBOOK_2026-10-11.md. RELEASE GATE: not applied until the owner signs off.
--
--   * Sports & Fitness (stored key sports_fitness, D1): 18 tags move out of Activities & Recreation; Boating and Water Sports
--     move to Outdoors & Nature (item 172). Moves go through the canonical engine (_taxonomy_impact + _taxonomy_apply, the
--     path a migration running as the owner uses), so each one is audited, bumps the taxonomy version, moves the paired
--     group columns of businesses whose primary tag moved, and records its code follow-ups.
--   * Travel & Getaways: Stay & Getaway's 10 live tags move into travel_experiences (the surviving key, D2); any stored
--     stay_getaway group value is rewritten; the key then stops being valid. The display label lives in the app.
--   * Arts, Culture & Events: display label only (the app); the stored key arts_culture_learning is kept.
--   * 24 new categories (items 169-181), 2 retirements (item 178, keep-existing, 0 uses), 7 customer-only Dating & Social tags
--     (item 185, new column customer_only: the opposite of business_only), max 5 secondary categories per business (item 186),
--     gathering format `league` (item 171), and the approved wordings (items 169-185).
--   * business_served_tags: a group-only business no longer serves retired or customer-only tags of its group.
-- Every step re-checks the live state first and the end asserts the result, so a drifted database aborts the whole file.

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. Preconditions: the live taxonomy is the one the mapping was made from.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare r record; n int;
begin
  for r in select * from (values
    ('Basketball', 'activities_recreation', 'sports_fitness'),
    ('Boating', 'activities_recreation', 'outdoors_nature'),
    ('Climbing', 'activities_recreation', 'sports_fitness'),
    ('Cycling', 'activities_recreation', 'sports_fitness'),
    ('Fitness', 'activities_recreation', 'sports_fitness'),
    ('Golf', 'activities_recreation', 'sports_fitness'),
    ('Gyms', 'activities_recreation', 'sports_fitness'),
    ('Martial Arts', 'activities_recreation', 'sports_fitness'),
    ('Padel', 'activities_recreation', 'sports_fitness'),
    ('Pickleball', 'activities_recreation', 'sports_fitness'),
    ('Pilates', 'activities_recreation', 'sports_fitness'),
    ('Running', 'activities_recreation', 'sports_fitness'),
    ('Skating', 'activities_recreation', 'sports_fitness'),
    ('Soccer', 'activities_recreation', 'sports_fitness'),
    ('Sports', 'activities_recreation', 'sports_fitness'),
    ('Swimming', 'activities_recreation', 'sports_fitness'),
    ('Tennis', 'activities_recreation', 'sports_fitness'),
    ('Volleyball', 'activities_recreation', 'sports_fitness'),
    ('Water Sports', 'activities_recreation', 'outdoors_nature'),
    ('Yoga', 'activities_recreation', 'sports_fitness'),
    ('Family Resorts', 'stay_getaway', 'travel_experiences'),
    ('Glamping', 'stay_getaway', 'travel_experiences'),
    ('Hotels', 'stay_getaway', 'travel_experiences'),
    ('Resorts', 'stay_getaway', 'travel_experiences'),
    ('Road Trip', 'stay_getaway', 'travel_experiences'),
    ('Romantic Getaways', 'stay_getaway', 'travel_experiences'),
    ('Spa Resorts', 'stay_getaway', 'travel_experiences'),
    ('Staycation', 'stay_getaway', 'travel_experiences'),
    ('Vacation Rentals', 'stay_getaway', 'travel_experiences'),
    ('Weekend Getaway', 'stay_getaway', 'travel_experiences')
  ) v(tag, old_group, new_group) loop
    if not exists (select 1 from category_tag_groups where tag = r.tag and group_key = r.old_group and retired_at is null) then
      raise exception 'Item 168 precondition: % is not a live tag of % (the mapping is stale; re-run the prep).', r.tag, r.old_group;
    end if;
  end loop;
  select count(*) into n from category_tag_groups where retired_at is null;
  if n <> 241 then raise exception 'Item 168 precondition: expected 241 live tags, found %.', n; end if;
  if exists (select 1 from category_tag_groups where lower(tag) in (select lower(t) from (values ('Tea'), ('Distilleries'), ('Axe Throwing'), ('Laser Tag'), ('Go-Karts'), ('Paintball'), ('Trampoline Parks'), ('Horseback Riding'), ('Recreation Centers'), ('Personal Training'), ('Grocery'), ('Sporting Goods'), ('Toys'), ('Bookstores'), ('Beauty Supply'), ('Pet Sitting'), ('House Painting'), ('Storage'), ('Contractors'), ('Home Security'), ('Auto Parts'), ('Dealerships'), ('Gas Stations'), ('Transportation Services')) x(t)))
     or exists (select 1 from category_tag_former_names where lower(name) in (select lower(t) from (values ('Tea'), ('Distilleries'), ('Axe Throwing'), ('Laser Tag'), ('Go-Karts'), ('Paintball'), ('Trampoline Parks'), ('Horseback Riding'), ('Recreation Centers'), ('Personal Training'), ('Grocery'), ('Sporting Goods'), ('Toys'), ('Bookstores'), ('Beauty Supply'), ('Pet Sitting'), ('House Painting'), ('Storage'), ('Contractors'), ('Home Security'), ('Auto Parts'), ('Dealerships'), ('Gas Stations'), ('Transportation Services')) x(t))) then
    raise exception 'Item 168 precondition: a new category name already exists (or was a former name).';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Customer-only marker (item 185): the opposite of business_only. Audited like business_only.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.category_tag_groups add column if not exists customer_only boolean not null default false;
alter table public.category_tag_groups drop constraint if exists category_tag_groups_one_side;
alter table public.category_tag_groups add constraint category_tag_groups_one_side check (not (business_only and customer_only));

alter table public.category_taxonomy_changes drop constraint if exists category_taxonomy_changes_change_type_check;
alter table public.category_taxonomy_changes add constraint category_taxonomy_changes_change_type_check check (change_type = any (array[
  'added', 'renamed', 'moved', 'retired', 'restored', 'business_only_changed', 'customer_only_changed']::text[]));

create or replace function public._taxonomy_record_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ver bigint;
  v_reason text := nullif(current_setting('app.taxonomy_reason', true), '');
  v_req uuid := nullif(current_setting('app.taxonomy_request_id', true), '')::uuid;
  v_impact jsonb := nullif(current_setting('app.taxonomy_impact', true), '')::jsonb;
begin
  -- No real change (e.g. an update that set the same values) = no version bump, no history row.
  if not exists (
    select 1 from old_rows o join new_rows n on n.id = o.id
    where (o.tag, o.group_key, o.retired_at is null, o.replaced_by, o.business_only, o.customer_only)
          is distinct from (n.tag, n.group_key, n.retired_at is null, n.replaced_by, n.business_only, n.customer_only)
  ) then
    return null;
  end if;
  v_ver := _taxonomy_bump_version();

  insert into category_tag_former_names (name, tag_id)
  select o.tag, o.id from old_rows o join new_rows n on n.id = o.id where o.tag <> n.tag
  on conflict do nothing;

  insert into category_taxonomy_changes (tag_id, change_type, old_name, new_name, old_group, new_group, replaced_by,
                                         taxonomy_version, actor_id, actor_kind, reason, request_id, impact)
  select n.id, x.change_type, x.old_name, x.new_name, x.old_group, x.new_group, x.replaced_by,
         v_ver, auth.uid(), _taxonomy_actor_kind(), v_reason, v_req, v_impact
  from old_rows o join new_rows n on n.id = o.id
  cross join lateral (values
    ('renamed', o.tag, n.tag, null::text, null::text, null::bigint, o.tag <> n.tag),
    ('moved', n.tag, n.tag, o.group_key, n.group_key, null::bigint, o.group_key <> n.group_key),
    ('retired', n.tag, n.tag, n.group_key, n.group_key, n.replaced_by, o.retired_at is null and n.retired_at is not null),
    ('restored', n.tag, n.tag, n.group_key, n.group_key, null::bigint, o.retired_at is not null and n.retired_at is null),
    ('business_only_changed', n.tag, n.tag, n.group_key, n.group_key, null::bigint, o.business_only is distinct from n.business_only),
    ('customer_only_changed', n.tag, n.tag, n.group_key, n.group_key, null::bigint, o.customer_only is distinct from n.customer_only)
  ) as x(change_type, old_name, new_name, old_group, new_group, replaced_by, happened)
  where x.happened;
  return null;
end $$;

-- The public snapshot carries the flag so the app hydrates it like business_only.
create or replace function public.get_category_taxonomy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', (select version from category_taxonomy_version where singleton),
    'pending_code_updates', (select count(*) from category_code_followups where status = 'open'),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'tag', g.tag, 'group_key', g.group_key,
                                                          'business_only', g.business_only, 'customer_only', g.customer_only,
                                                          'retired', g.retired_at is not null, 'replaced_by', r.tag) order by g.id)
                      from category_tag_groups g left join category_tag_groups r on r.id = g.replaced_by), '[]'::jsonb),
    'former_names', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'tag_id', f.tag_id, 'current_tag', t.current_tag,
                                                                  'retired', t.retired) order by f.name)
                              from category_tag_former_names f cross join lateral _taxonomy_live_target(f.tag_id) t), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. sports_fitness becomes a valid group (stay_getaway stays valid until its tags and values have moved, step 4).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.category_major_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social', 'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see']
$$;
alter table public.brand_partners drop constraint if exists brand_partners_category_check;
alter table public.brand_partners add constraint brand_partners_category_check check (category is null or category = any (array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social', 'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see', 'other']::text[]));
alter table public.business_partner_requests drop constraint if exists business_partner_requests_category_check;
alter table public.business_partner_requests add constraint business_partner_requests_category_check check (category is null or category = any (array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social', 'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see', 'other']::text[]));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The 30 moves, through the canonical engine (preview -> impact token -> apply; a deterministic request id per tag, so a
--    re-run returns the committed result instead of moving twice).
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare r record; v_id bigint; v_impact jsonb; v_res jsonb;
begin
  for r in select * from (values
    ('Basketball', 'activities_recreation', 'sports_fitness'),
    ('Boating', 'activities_recreation', 'outdoors_nature'),
    ('Climbing', 'activities_recreation', 'sports_fitness'),
    ('Cycling', 'activities_recreation', 'sports_fitness'),
    ('Fitness', 'activities_recreation', 'sports_fitness'),
    ('Golf', 'activities_recreation', 'sports_fitness'),
    ('Gyms', 'activities_recreation', 'sports_fitness'),
    ('Martial Arts', 'activities_recreation', 'sports_fitness'),
    ('Padel', 'activities_recreation', 'sports_fitness'),
    ('Pickleball', 'activities_recreation', 'sports_fitness'),
    ('Pilates', 'activities_recreation', 'sports_fitness'),
    ('Running', 'activities_recreation', 'sports_fitness'),
    ('Skating', 'activities_recreation', 'sports_fitness'),
    ('Soccer', 'activities_recreation', 'sports_fitness'),
    ('Sports', 'activities_recreation', 'sports_fitness'),
    ('Swimming', 'activities_recreation', 'sports_fitness'),
    ('Tennis', 'activities_recreation', 'sports_fitness'),
    ('Volleyball', 'activities_recreation', 'sports_fitness'),
    ('Water Sports', 'activities_recreation', 'outdoors_nature'),
    ('Yoga', 'activities_recreation', 'sports_fitness'),
    ('Family Resorts', 'stay_getaway', 'travel_experiences'),
    ('Glamping', 'stay_getaway', 'travel_experiences'),
    ('Hotels', 'stay_getaway', 'travel_experiences'),
    ('Resorts', 'stay_getaway', 'travel_experiences'),
    ('Road Trip', 'stay_getaway', 'travel_experiences'),
    ('Romantic Getaways', 'stay_getaway', 'travel_experiences'),
    ('Spa Resorts', 'stay_getaway', 'travel_experiences'),
    ('Staycation', 'stay_getaway', 'travel_experiences'),
    ('Vacation Rentals', 'stay_getaway', 'travel_experiences'),
    ('Weekend Getaway', 'stay_getaway', 'travel_experiences')
  ) v(tag, old_group, new_group) loop
    select id into v_id from category_tag_groups where tag = r.tag;
    v_impact := _taxonomy_impact('move', v_id, null, r.new_group, null, false);
    if jsonb_array_length(coalesce(v_impact->'blockers', '[]'::jsonb)) > 0 then
      raise exception 'Item 168: moving % is blocked: %', r.tag, v_impact->'blockers';
    end if;
    v_res := _taxonomy_apply('move', r.tag, null, r.new_group, null, false,
                             'Item 168 V1 category pass (owner items 168, 171, 172, 179): ' || r.old_group || ' -> ' || r.new_group,
                             v_impact->>'impact_token', md5('item168:move:' || r.tag)::uuid);
    if not coalesce((v_res->>'changed')::boolean, false) then
      raise exception 'Item 168: moving % did not change anything: %', r.tag, v_res;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3b. Retire Pet Friendly Places and Pet Friendly Stays (item 178, keep-existing; pet-friendliness is the attribute only).
--     Pet Friendly Stays first follows its group into travel_experiences, so no row (live or retired) keeps stay_getaway.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare t text; v_id bigint; v_impact jsonb;
begin
  select id into v_id from category_tag_groups where tag = 'Pet Friendly Stays';
  v_impact := _taxonomy_impact('move', v_id, null, 'travel_experiences', null, false);
  perform _taxonomy_apply('move', 'Pet Friendly Stays', null, 'travel_experiences', null, false,
                          'Item 168 V1 category pass (owner items 168, 179): Stay & Getaway merges into Travel & Getaways',
                          v_impact->>'impact_token', md5('item168:move:Pet Friendly Stays')::uuid);
  foreach t in array array['Pet Friendly Places', 'Pet Friendly Stays'] loop
    select id into v_id from category_tag_groups where tag = t;
    v_impact := _taxonomy_impact('retire', v_id, null, null, null, true);
    if jsonb_array_length(coalesce(v_impact->'blockers', '[]'::jsonb)) > 0 then
      raise exception 'Item 168: retiring % is blocked: %', t, v_impact->'blockers';
    end if;
    perform _taxonomy_apply('retire', t, null, null, null, true,
                            'Item 168 V1 category pass (owner item 178): pet-friendliness is the attribute only',
                            v_impact->>'impact_token', md5('item168:retire:' || t)::uuid);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Stay & Getaway stops existing: every stored group value follows its tags into travel_experiences (0 rows on
--    2026-10-11; a business that signs up before this runs is carried over, never dropped), then the key is refused.
-- ---------------------------------------------------------------------------------------------------------------------
update public.brand_partners set category = 'travel_experiences' where category = 'stay_getaway';
update public.business_partner_requests set category = 'travel_experiences' where category = 'stay_getaway';
update public.category_aliases set category = 'travel_experiences' where category = 'stay_getaway';
update public.profiles set interest_groups = array(select distinct case when g = 'stay_getaway' then 'travel_experiences' else g end
                                                   from unnest(interest_groups) g)
 where 'stay_getaway' = any (interest_groups);
do $$
declare c record; n int;
begin
  if exists (select 1 from category_tag_groups where group_key = 'stay_getaway') then
    raise exception 'Item 168: a tag still sits in stay_getaway.';
  end if;
  -- Any other text / text[] column still holding the key (history tables named category_* keep it by design: the audit log).
  for c in
    select cl.table_name, cl.column_name, cl.data_type
    from information_schema.columns cl join information_schema.tables t using (table_schema, table_name)
    where cl.table_schema = 'public' and t.table_type = 'BASE TABLE' and cl.table_name not like 'category\_%'
      and (cl.data_type in ('text', 'character varying') or cl.udt_name = '_text')
  loop
    execute format(case when c.data_type = 'ARRAY' then 'select count(*) from public.%I where %L = any (%I)'
                        else 'select count(*) from public.%I where %I = %L' end,
                   c.table_name, case when c.data_type = 'ARRAY' then 'stay_getaway' else c.column_name end,
                   case when c.data_type = 'ARRAY' then c.column_name else 'stay_getaway' end) into n;
    if n > 0 then raise exception 'Item 168: %.% still stores stay_getaway in % row(s); map it before running this.', c.table_name, c.column_name, n; end if;
  end loop;
end $$;

create or replace function public.category_major_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social', 'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'health_personal_care', 'education_classes', 'attractions_things_to_see']
$$;
alter table public.brand_partners drop constraint brand_partners_category_check;
alter table public.brand_partners add constraint brand_partners_category_check check (category is null or category = any (array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social', 'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'health_personal_care', 'education_classes', 'attractions_things_to_see', 'other']::text[]));
alter table public.business_partner_requests drop constraint business_partner_requests_category_check;
alter table public.business_partner_requests add constraint business_partner_requests_category_check check (category is null or category = any (array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social', 'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'health_personal_care', 'education_classes', 'attractions_things_to_see', 'other']::text[]));

-- Same signature (single overload). The allowed groups now come from category_major_keys() instead of a copied list (it
-- had to be edited in step with it every time), and a primary category must be a live, business-selectable tag of its group.
create or replace function public.update_business_profile(partner_id_param uuid, name_param text, description_param text,
  address_param text, latitude_param double precision, longitude_param double precision, logo_url_param text,
  category_param text default null, attributes_param text[] default null, cuisine_param text default null,
  differentiator_param text default null, subcategory_param text default null, categories_param text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_valid_subcats text[];
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if name_param is null or trim(name_param) = '' then
    raise exception 'Business name cannot be empty';
  end if;

  if category_param is not null and not (category_param = any (public.category_major_keys() || array['other'])) then
    raise exception 'Invalid category';
  end if;

  if attributes_param is not null and not (attributes_param <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu', 'pet_friendly', 'romantic', 'catering', 'lively', 'trendy', 'cozy', 'relaxed', 'social', 'professional'
  ]::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'bbq', 'korean', 'vietnamese', 'greek', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if differentiator_param is not null and char_length(differentiator_param) > 280 then
    raise exception 'Differentiator is too long';
  end if;

  if categories_param is not null and not public.all_valid_category_tags(categories_param) then
    raise exception 'Invalid secondary category';
  end if;

  select coalesce(array_agg(tag), array[]::text[]) into v_valid_subcats
  from public.category_tag_groups where group_key = category_param and not customer_only;
  if subcategory_param is not null and not (subcategory_param = any(v_valid_subcats)) then
    raise exception 'Invalid subcategory for this category';
  end if;

  update brand_partners
  set name = name_param,
      description = description_param,
      address = address_param,
      latitude = latitude_param,
      longitude = longitude_param,
      logo_url = logo_url_param,
      category = category_param,
      attributes = coalesce(attributes_param, attributes),
      cuisine = case when attributes_param is not null then cuisine_param else cuisine end,
      differentiator = coalesce(differentiator_param, differentiator),
      subcategory = subcategory_param,
      categories = coalesce(categories_param, categories)
  where id = partner_id_param;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The 24 new categories (items 169, 170, 171, 175, 178, 180, 181): ordinary leaf tags, no special behavior. Keys are the
--    permanent snake_case of the name (what _category_key_from_name would derive).
-- ---------------------------------------------------------------------------------------------------------------------
select set_config('app.taxonomy_reason', 'Item 168 V1 category pass: new categories (owner items 169-181)', true);
insert into public.category_tag_groups (tag, group_key, key) values
  ('Tea', 'food_drink', 'tea'),
  ('Distilleries', 'food_drink', 'distilleries'),
  ('Axe Throwing', 'activities_recreation', 'axe_throwing'),
  ('Laser Tag', 'activities_recreation', 'laser_tag'),
  ('Go-Karts', 'activities_recreation', 'go_karts'),
  ('Paintball', 'activities_recreation', 'paintball'),
  ('Trampoline Parks', 'activities_recreation', 'trampoline_parks'),
  ('Horseback Riding', 'activities_recreation', 'horseback_riding'),
  ('Recreation Centers', 'activities_recreation', 'recreation_centers'),
  ('Personal Training', 'sports_fitness', 'personal_training'),
  ('Grocery', 'shopping', 'grocery'),
  ('Sporting Goods', 'shopping', 'sporting_goods'),
  ('Toys', 'shopping', 'toys'),
  ('Bookstores', 'shopping', 'bookstores'),
  ('Beauty Supply', 'shopping', 'beauty_supply'),
  ('Pet Sitting', 'pets', 'pet_sitting'),
  ('House Painting', 'home_local_services', 'house_painting'),
  ('Storage', 'home_local_services', 'storage'),
  ('Contractors', 'home_local_services', 'contractors'),
  ('Home Security', 'home_local_services', 'home_security'),
  ('Auto Parts', 'auto_transportation', 'auto_parts'),
  ('Dealerships', 'auto_transportation', 'dealerships'),
  ('Gas Stations', 'auto_transportation', 'gas_stations'),
  ('Transportation Services', 'auto_transportation', 'transportation_services');
select set_config('app.taxonomy_reason', '', true);

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Customer-only Dating & Social (item 185): a person may ask for these; no business may declare one. Speed Dating,
--    Singles Events and Social Clubs stay business-selectable.
-- ---------------------------------------------------------------------------------------------------------------------
select set_config('app.taxonomy_reason', 'Item 168 V1 category pass: customer-only Dating & Social categories (owner item 185)', true);
update public.category_tag_groups set customer_only = true where tag in ('Dating', 'Date Night', 'First Date', 'Double Date', 'Couples', 'Group Hangouts', 'Make New Friends') and group_key = 'dating_social';
select set_config('app.taxonomy_reason', '', true);

-- Routing: a group-only business serves its group's LIVE, business-selectable tags (never a retired or customer-only one).
create or replace function public.business_served_tags(partner_id_param uuid)
returns text[] language sql stable security definer set search_path = public as $$
  with p as (
    select category, subcategory, coalesce(categories, array[]::text[]) as cats
    from brand_partners where id = partner_id_param
  ), declared as (
    select subcategory as tag from p where subcategory is not null
    union select unnest(cats) from p
    union select ba.category from business_availability ba where ba.partner_id = partner_id_param and ba.category is not null
  )
  select coalesce(array_agg(distinct t), array[]::text[]) from (
    select tag as t from declared where tag is not null
    union
    select ctg.tag from p join category_tag_groups ctg on ctg.group_key = p.category
     where p.subcategory is null and cardinality(p.cats) = 0 and ctg.retired_at is null and not ctg.customer_only
  ) s;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Business category rules on every write path (signup edge function, dashboard RPC, admin mapping, postings): never a
--    customer-only category (primary, secondary, availability posting, boost), and at most 5 secondary categories (item
--    186). Checked only when the value is new or grows, so an existing row is never broken by an unrelated edit.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._enforce_business_category_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
  v_new_n int;
  v_old_n int;
begin
  if TG_TABLE_NAME in ('business_availability', 'business_priority_signals') then
    if v_row->>'category' is distinct from v_old->>'category'
       and exists (select 1 from category_tag_groups where tag = v_row->>'category' and customer_only) then
      raise exception 'That category is for people, not businesses.' using errcode = '23514';
    end if;
    return NEW;
  end if;
  -- brand_partners / business_partner_requests: subcategory (primary) + categories (secondary)
  if v_row->>'subcategory' is distinct from v_old->>'subcategory'
     and exists (select 1 from category_tag_groups where tag = v_row->>'subcategory' and customer_only) then
    raise exception 'That category is for people, not businesses.' using errcode = '23514';
  end if;
  if v_row->'categories' is distinct from v_old->'categories' and jsonb_typeof(v_row->'categories') = 'array' then
    if exists (select 1 from category_tag_groups g
               where g.customer_only and g.tag in (select jsonb_array_elements_text(v_row->'categories'))) then
      raise exception 'That category is for people, not businesses.' using errcode = '23514';
    end if;
    select count(distinct t) into v_new_n from jsonb_array_elements_text(v_row->'categories') t
     where t is distinct from v_row->>'subcategory';
    select count(distinct t) into v_old_n from jsonb_array_elements_text(coalesce(v_old->'categories', '[]'::jsonb)) t
     where t is distinct from v_old->>'subcategory';
    if v_new_n > 5 and v_new_n > coalesce(v_old_n, 0) then
      raise exception 'A business can add up to 5 more categories.' using errcode = '23514';
    end if;
  end if;
  return NEW;
end $$;
revoke all on function public._enforce_business_category_rules() from public, anon, authenticated;

drop trigger if exists enforce_business_category_rules on public.brand_partners;
create trigger enforce_business_category_rules before insert or update on public.brand_partners
  for each row execute function public._enforce_business_category_rules();
drop trigger if exists enforce_business_category_rules on public.business_partner_requests;
create trigger enforce_business_category_rules before insert or update on public.business_partner_requests
  for each row execute function public._enforce_business_category_rules();
drop trigger if exists enforce_business_category_rules on public.business_availability;
create trigger enforce_business_category_rules before insert or update on public.business_availability
  for each row execute function public._enforce_business_category_rules();
drop trigger if exists enforce_business_category_rules on public.business_priority_signals;
create trigger enforce_business_category_rules before insert or update on public.business_priority_signals
  for each row execute function public._enforce_business_category_rules();

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Gathering format `league` (item 171): a format, not a category.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.gatherings drop constraint if exists gatherings_format_check;
alter table public.gatherings
  add constraint gatherings_format_check check (format is null or format in (
    'drop_in', 'class', 'tournament', 'meetup', 'concert', 'show', 'festival', 'tour', 'workshop', 'appointment', 'reservation',
    'open_play', 'competition', 'exhibition', 'market', 'party', 'league'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. The approved wordings (items 169-185). Same rows as the client table (src/constants/categorySynonyms.js, the item-168
--    block; categorySynonyms.test.js keeps them identical). Phrases stored normalized, the form seedRows() produces.
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.category_synonyms (phrase, tag) values
  ('tea house', 'Tea'),
  ('tea room', 'Tea'),
  ('bubble tea', 'Tea'),
  ('craft spirit', 'Distilleries'),
  ('adventure park', 'Adventure'),
  ('rope course', 'Adventure'),
  ('zipline', 'Adventure'),
  ('baseball', 'Sports'),
  ('softball', 'Sports'),
  ('hockey', 'Sports'),
  ('sport club', 'Sports'),
  ('athletic club', 'Sports'),
  ('crossfit', 'Gyms'),
  ('crossfit', 'Fitness'),
  ('dance fitness', 'Fitness'),
  ('zumba', 'Fitness'),
  ('scenic area', 'Scenic Views'),
  ('scenic spot', 'Scenic Views'),
  ('viewpoint', 'Scenic Views'),
  ('overlook', 'Scenic Views'),
  ('water activity', 'Water Sports'),
  ('nature center', 'Parks'),
  ('nature center', 'Wildlife'),
  ('nature preserve', 'Parks'),
  ('nature preserve', 'Wildlife'),
  ('night market', 'Markets'),
  ('cinema', 'Movies'),
  ('movie theater', 'Movies'),
  ('stand up', 'Comedy'),
  ('standup', 'Comedy'),
  ('nightlife event', 'Nightlife'),
  ('gallery', 'Art Galleries'),
  ('exhibition', 'Exhibits'),
  ('art show', 'Art'),
  ('art fair', 'Art'),
  ('local event', 'Community Events'),
  ('book event', 'Reading'),
  ('book signing', 'Reading'),
  ('author talk', 'Reading'),
  ('book club', 'Reading'),
  ('gift store', 'Gift Shop'),
  ('thrift store', 'Thrift & Vintage'),
  ('thrift shop', 'Thrift & Vintage'),
  ('vintage store', 'Thrift & Vintage'),
  ('consignment', 'Thrift & Vintage'),
  ('furniture', 'Home & Furniture'),
  ('home decor', 'Home & Furniture'),
  ('home good', 'Home & Furniture'),
  ('shoe store', 'Clothing'),
  ('shoe', 'Clothing'),
  ('sneaker', 'Clothing'),
  ('flea market', 'Markets'),
  ('swap meet', 'Markets'),
  ('grocery store', 'Grocery'),
  ('supermarket', 'Grocery'),
  ('convenience store', 'Grocery'),
  ('bodega', 'Grocery'),
  ('corner store', 'Grocery'),
  ('sport store', 'Sporting Goods'),
  ('sporting good store', 'Sporting Goods'),
  ('toy store', 'Toys'),
  ('toy shop', 'Toys'),
  ('book shop', 'Bookstores'),
  ('bookshop', 'Bookstores'),
  ('cosmetic', 'Beauty Supply'),
  ('makeup store', 'Beauty Supply'),
  ('beauty store', 'Beauty Supply'),
  ('facial', 'Skin Care'),
  ('skincare', 'Skin Care'),
  ('beauty salon', 'Salons'),
  ('children s activity', 'Kids Activity'),
  ('kids class', 'Kids Education'),
  ('educational activity', 'Kids Education'),
  ('pet shop', 'Pet Stores'),
  ('pet supply', 'Pet Stores'),
  ('pet food', 'Pet Stores'),
  ('vet', 'Veterinary'),
  ('vets', 'Veterinary'),
  ('veterinarian', 'Veterinary'),
  ('animal hospital', 'Veterinary'),
  ('pet clinic', 'Veterinary'),
  ('kennel', 'Pet Boarding'),
  ('doggy daycare', 'Pet Boarding'),
  ('dog daycare', 'Pet Boarding'),
  ('pet hotel', 'Pet Boarding'),
  ('dog walker', 'Dog Walking'),
  ('pet sitter', 'Pet Sitting'),
  ('cat sitter', 'Pet Sitting'),
  ('house sitting for pets', 'Pet Sitting'),
  ('pet activity', 'Pet Events'),
  ('pet activity', 'Dog Meetup'),
  ('dog training', 'Pet Training'),
  ('family getaway', 'Family Resorts'),
  ('family vacation', 'Family Resorts'),
  ('cruise', 'Boat Tours'),
  ('sunset cruise', 'Boat Tours'),
  ('dinner cruise', 'Boat Tours'),
  ('harbor cruise', 'Boat Tours'),
  ('cabin', 'Vacation Rentals'),
  ('vacation home', 'Vacation Rentals'),
  ('beach house', 'Vacation Rentals'),
  ('weekend trip', 'Weekend Getaway'),
  ('weekend away', 'Weekend Getaway'),
  ('campground', 'Camping'),
  ('campsite', 'Camping'),
  ('bed and breakfast', 'Hotels'),
  ('b and b', 'Hotels'),
  ('attraction', 'Amusement Park'),
  ('attraction', 'Aquariums'),
  ('attraction', 'Exhibits'),
  ('attraction', 'Historic Sites'),
  ('attraction', 'Landmarks'),
  ('attraction', 'Local Attractions'),
  ('attraction', 'Museums'),
  ('attraction', 'Observation Decks'),
  ('attraction', 'Sightseeing'),
  ('attraction', 'Tourist Attractions'),
  ('attraction', 'Zoos'),
  ('thing to see', 'Amusement Park'),
  ('thing to see', 'Aquariums'),
  ('thing to see', 'Exhibits'),
  ('thing to see', 'Historic Sites'),
  ('thing to see', 'Landmarks'),
  ('thing to see', 'Local Attractions'),
  ('thing to see', 'Museums'),
  ('thing to see', 'Observation Decks'),
  ('thing to see', 'Sightseeing'),
  ('thing to see', 'Tourist Attractions'),
  ('thing to see', 'Zoos'),
  ('maid', 'Cleaning'),
  ('housekeeping', 'Cleaning'),
  ('house cleaner', 'Cleaning'),
  ('landscaper', 'Landscaping'),
  ('gardener', 'Landscaping'),
  ('lawn care', 'Landscaping'),
  ('lawn mowing', 'Landscaping'),
  ('mow my lawn', 'Landscaping'),
  ('yard work', 'Landscaping'),
  ('lawn service', 'Landscaping'),
  ('mover', 'Moving'),
  ('exterminator', 'Pest Control'),
  ('bed bugs', 'Pest Control'),
  ('termite', 'Pest Control'),
  ('ac repair', 'HVAC'),
  ('air conditioning', 'HVAC'),
  ('heating', 'HVAC'),
  ('furnace', 'HVAC'),
  ('ac', 'HVAC'),
  ('heat pump', 'HVAC'),
  ('house painter', 'House Painting'),
  ('painter', 'House Painting'),
  ('interior painting', 'House Painting'),
  ('exterior painting', 'House Painting'),
  ('storage unit', 'Storage'),
  ('self storage', 'Storage'),
  ('storage space', 'Storage'),
  ('general contractor', 'Contractors'),
  ('home improvement', 'Contractors'),
  ('remodel', 'Contractors'),
  ('remodeling', 'Contractors'),
  ('renovation', 'Contractors'),
  ('roofer', 'Contractors'),
  ('roofing', 'Contractors'),
  ('security system', 'Home Security'),
  ('alarm system', 'Home Security'),
  ('security camera', 'Home Security'),
  ('body shop', 'Auto Repair'),
  ('collision repair', 'Auto Repair'),
  ('brake', 'Auto Repair'),
  ('smog check', 'Auto Repair'),
  ('car inspection', 'Auto Repair'),
  ('windshield', 'Auto Repair'),
  ('tow truck', 'Towing'),
  ('roadside assistance', 'Towing'),
  ('car part', 'Auto Parts'),
  ('auto part store', 'Auto Parts'),
  ('car dealer', 'Dealerships'),
  ('used cars', 'Dealerships'),
  ('new cars', 'Dealerships'),
  ('buy a car', 'Dealerships'),
  ('rental car', 'Car Rental'),
  ('rent a car', 'Car Rental'),
  ('charging station', 'EV Charging'),
  ('ev charger', 'EV Charging'),
  ('car charger', 'EV Charging'),
  ('gas', 'Gas Stations'),
  ('fuel', 'Gas Stations'),
  ('fill up', 'Gas Stations'),
  ('taxi service', 'Transportation Services'),
  ('car service', 'Transportation Services'),
  ('airport shuttle', 'Transportation Services'),
  ('shuttle service', 'Transportation Services'),
  ('limo', 'Transportation Services'),
  ('limousine', 'Transportation Services'),
  ('chauffeur', 'Transportation Services'),
  ('party bus', 'Transportation Services'),
  ('painting class', 'Art Classes'),
  ('drawing class', 'Art Classes'),
  ('music class', 'Music Lessons'),
  ('guitar lesson', 'Music Lessons'),
  ('piano lesson', 'Music Lessons'),
  ('voice lesson', 'Music Lessons'),
  ('singing lesson', 'Music Lessons'),
  ('dance lesson', 'Dance Classes'),
  ('salsa lesson', 'Dance Classes'),
  ('ballet class', 'Dance Classes'),
  ('language lesson', 'Language Classes'),
  ('esl', 'Language Classes'),
  ('english class', 'Language Classes'),
  ('spanish class', 'Language Classes'),
  ('spanish lesson', 'Language Classes'),
  ('coding class', 'Technology Classes'),
  ('coding bootcamp', 'Technology Classes'),
  ('computer class', 'Technology Classes'),
  ('programming class', 'Technology Classes'),
  ('business course', 'Professional Development'),
  ('business workshop', 'Professional Development'),
  ('entrepreneurship class', 'Professional Development'),
  ('job training', 'Professional Development'),
  ('skill training', 'Professional Development'),
  ('tutor', 'Tutoring'),
  ('math tutor', 'Tutoring'),
  ('homework help', 'Tutoring'),
  ('adult class', 'Adult Education'),
  ('volunteer', 'Volunteering'),
  ('volunteer opportunity', 'Volunteering'),
  ('volunteer work', 'Volunteering'),
  ('community service', 'Volunteering'),
  ('give back', 'Volunteering'),
  ('giving back', 'Volunteering'),
  ('nonprofit', 'Charity'),
  ('non profit', 'Charity'),
  ('food drive', 'Donation Drives'),
  ('food bank', 'Donation Drives'),
  ('toy drive', 'Donation Drives'),
  ('clothing drive', 'Donation Drives'),
  ('blood drive', 'Donation Drives'),
  ('community meeting', 'Community Events'),
  ('town hall', 'Community Events'),
  ('public meeting', 'Community Events'),
  ('civic event', 'Community Events'),
  ('city council meeting', 'Community Events'),
  ('public hearing', 'Community Events'),
  ('neighborhood meeting', 'Neighborhood Events'),
  ('hoa meeting', 'Neighborhood Events'),
  ('block party', 'Neighborhood Events'),
  ('church', 'Faith & Spirituality'),
  ('temple', 'Faith & Spirituality'),
  ('mosque', 'Faith & Spirituality'),
  ('synagogue', 'Faith & Spirituality'),
  ('co working', 'Coworking'),
  ('shared office', 'Coworking'),
  ('shared workspace', 'Coworking'),
  ('seminar', 'Professional Events'),
  ('seminar', 'Lectures'),
  ('business event', 'Professional Events'),
  ('industry event', 'Professional Events'),
  ('trade show', 'Professional Events'),
  ('trade expo', 'Professional Events'),
  ('business expo', 'Professional Events'),
  ('professional group', 'Professional Events'),
  ('professional association', 'Professional Events'),
  ('industry group', 'Professional Events'),
  ('entrepreneur', 'Entrepreneurship'),
  ('startup event', 'Entrepreneurship'),
  ('startup meetup', 'Entrepreneurship'),
  ('founder meetup', 'Entrepreneurship'),
  ('pitch night', 'Entrepreneurship'),
  ('career fair', 'Career Events'),
  ('job fair', 'Career Events'),
  ('hiring event', 'Career Events'),
  ('accountant', 'Finance'),
  ('accounting', 'Finance'),
  ('bookkeeping', 'Finance'),
  ('tax preparation', 'Finance'),
  ('tax prep', 'Finance'),
  ('financial advisor', 'Finance'),
  ('realtor', 'Real Estate'),
  ('real estate agent', 'Real Estate'),
  ('single mixer', 'Singles Events'),
  ('single night', 'Singles Events'),
  ('single meetup', 'Singles Events'),
  ('social group', 'Social Clubs')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Postconditions: the result is exactly the approved V1 set.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  if (select count(*) from category_tag_groups where retired_at is null) <> 263 then
    raise exception 'Item 168 postcondition: expected 263 live tags, found %.', (select count(*) from category_tag_groups where retired_at is null);
  end if;
  select string_agg(distinct group_key, ', ') into v_bad from category_tag_groups
   where retired_at is null and not (group_key = any (category_major_keys()));
  if v_bad is not null then raise exception 'Item 168 postcondition: tags in unknown groups: %', v_bad; end if;
  if cardinality(category_major_keys()) <> 19 then raise exception 'Item 168 postcondition: expected 19 groups.'; end if;
  select string_agg(format('%s=%s', group_key, n), ', ') into v_bad from (
    select group_key, count(*) n from category_tag_groups where retired_at is null group by group_key) s
   where (group_key, n) not in (('activities_recreation', 11), ('arts_culture_learning', 13), ('attractions_things_to_see', 11), ('auto_transportation', 13), ('business_networking', 8), ('community_volunteering', 8), ('dating_social', 10), ('education_classes', 16), ('entertainment_nightlife', 23), ('family_kids', 10), ('food_drink', 20), ('health_personal_care', 9), ('home_local_services', 14), ('outdoors_nature', 19), ('pets', 12), ('shopping', 19), ('sports_fitness', 19), ('travel_experiences', 17), ('wellness_beauty', 11));
  if v_bad is not null then raise exception 'Item 168 postcondition: group sizes differ from the mapping: %', v_bad; end if;
  if (select count(*) from category_tag_groups where customer_only) <> 7 then
    raise exception 'Item 168 postcondition: expected 7 customer-only tags.';
  end if;
  if exists (select 1 from category_synonyms s join category_tag_groups g on g.tag = s.tag where g.retired_at is not null) then
    raise exception 'Item 168 postcondition: a synonym points at a retired tag.';
  end if;
  if exists (select 1 from brand_partners where subcategory is not null and category is distinct from
               (select group_key from category_tag_groups where tag = subcategory)) then
    raise exception 'Item 168 postcondition: a business primary tag is outside its stored group.';
  end if;
end $$;
