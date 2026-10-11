-- Item 168 ROLLBACK: reverses migration 20270294 (V1 category pass) after it was applied and committed.
-- Needs the pre-apply snapshot (scripts/rollback/20270294_v1_category_pass.snapshot.sql -> schema item168_backup).
-- Runbook: PRODUCT_AUDIT/ITEM_168_MIGRATION_RUNBOOK_2026-10-11.md. Run it as ONE transaction (begin ... commit); any failed
-- guard or postcondition aborts the whole file and leaves the V1 state untouched.
--
-- Why a reverse pass, not a restore: category_taxonomy_changes is append-only and references tag ids, and ids/keys are
-- permanent, so taxonomy rows are never deleted. Every taxonomy change goes back through the canonical engine
-- (_taxonomy_impact + _taxonomy_apply), audited with an "Item 168 rollback" reason and a new taxonomy version:
--   * the 30 moves go back (Sports & Fitness -> Activities & Recreation, Boating / Water Sports -> Activities, the ten
--     lodging tags -> Stay & Getaway); the engine re-pairs each business's group with its primary tag;
--   * Pet Friendly Places / Stays are restored (Stays back into Stay & Getaway);
--   * the 24 new categories are RETIRED (they stay as retired rows; nothing used them, or the guard below refused);
--   * customer-only is cleared on the 7 Dating & Social tags, then the column is dropped.
-- Then data and code objects come back from the snapshot: stored group keys, profile interest groups, aliases, synonyms,
-- and the exact pre-apply text of every function and CHECK the migration redefined. The enforcement trigger is dropped.
-- Knowingly NOT reverted: the audit log (append-only; it keeps the pass and its reversal), the widened change_type CHECK
-- (it must admit the audit rows of type customer_only_changed), the taxonomy version (it only goes up), the retired rows
-- of the 24 new categories, and code follow-ups (resolved by syncing the main-branch code inventory afterwards).

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. Guards
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare n int; v_bad text;
begin
  if to_regnamespace('item168_backup') is null then
    raise exception 'Item 168 rollback: no snapshot (schema item168_backup). Without it this cannot restore the pre-apply state.';
  end if;
  if not ('sports_fitness' = any (public.category_major_keys())) then
    raise exception 'Item 168 rollback: migration 20270294 is not applied (no sports_fitness group).';
  end if;
  select count(*) into n from public.gatherings where format = 'league';
  if n > 0 then
    raise exception 'Item 168 rollback: % gathering(s) use the league format; the old format list refuses it. Decide their format first.', n;
  end if;
  -- A new category already in real use: retiring it would strand that use. The owner decides, never this script.
  select string_agg(distinct t, ', ') into v_bad from (
    select subcategory t from public.brand_partners union all select unnest(categories) from public.brand_partners
    union all select subcategory from public.business_partner_requests union all select unnest(categories) from public.business_partner_requests
    union all select category from public.business_availability union all select category from public.business_priority_signals
    union all select category from public.business_requests
    union all select interest_tag from public.gatherings union all select unnest(interests) from public.profiles
  ) u where t in (select tag from public.category_tag_groups where id not in (select id from item168_backup.category_tag_groups));
  if v_bad is not null then
    raise exception 'Item 168 rollback: new categories already in use (%). Rolling back would retire them under live data; stop and ask the owner.', v_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Make room for the reversal: the enforcement trigger goes; both old and new group keys are valid while tags move back.
-- ---------------------------------------------------------------------------------------------------------------------
drop trigger if exists enforce_business_category_rules on public.brand_partners;
drop trigger if exists enforce_business_category_rules on public.business_partner_requests;
drop trigger if exists enforce_business_category_rules on public.business_availability;
drop trigger if exists enforce_business_category_rules on public.business_priority_signals;
drop function if exists public._enforce_business_category_rules();

alter table public.brand_partners drop constraint if exists brand_partners_category_check;
alter table public.business_partner_requests drop constraint if exists business_partner_requests_category_check;

create or replace function public.category_major_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['food_drink', 'activities_recreation', 'sports_fitness', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids', 'outdoors_nature', 'pets', 'home_local_services',
    'auto_transportation', 'business_networking', 'community_volunteering', 'travel_experiences', 'stay_getaway',
    'health_personal_care', 'education_classes', 'attractions_things_to_see']::text[]
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Taxonomy, through the canonical engine. Deterministic request ids: a re-run replays instead of applying twice.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare r record; v_id bigint; v_impact jsonb; v_res jsonb;
  v_reason constant text := 'Item 168 rollback (owner-ordered) of the V1 category pass, migration 20270294';
begin
  -- 2a. Restore the two retired pet tags; Pet Friendly Stays then returns to Stay & Getaway.
  for r in select b.id, b.tag from item168_backup.category_tag_groups b
           join public.category_tag_groups c using (id) where not b.retired and c.retired_at is not null loop
    v_impact := _taxonomy_impact('restore', r.id, null, null, null, false);
    if jsonb_array_length(coalesce(v_impact->'blockers', '[]'::jsonb)) > 0 then
      raise exception 'Item 168 rollback: restoring % is blocked: %', r.tag, v_impact->'blockers';
    end if;
    v_res := _taxonomy_apply('restore', r.tag, null, null, null, false, v_reason, v_impact->>'impact_token',
                             md5('item168-rollback:restore:' || r.tag)::uuid);
  end loop;

  -- 2b. Every tag whose group differs from the snapshot goes back (the 30 moves, plus Pet Friendly Stays).
  for r in select b.id, b.tag, b.group_key as old_group from item168_backup.category_tag_groups b
           join public.category_tag_groups c using (id) where c.group_key <> b.group_key order by b.tag loop
    v_impact := _taxonomy_impact('move', r.id, null, r.old_group, null, false);
    if jsonb_array_length(coalesce(v_impact->'blockers', '[]'::jsonb)) > 0 then
      raise exception 'Item 168 rollback: moving % back is blocked: %', r.tag, v_impact->'blockers';
    end if;
    v_res := _taxonomy_apply('move', r.tag, null, r.old_group, null, false, v_reason, v_impact->>'impact_token',
                             md5('item168-rollback:move:' || r.tag)::uuid);
    if not coalesce((v_res->>'changed')::boolean, false) then
      raise exception 'Item 168 rollback: moving % back changed nothing: %', r.tag, v_res;
    end if;
  end loop;

  -- 2c. Retire the categories the pass added (unused: the guard above made sure).
  for r in select c.id, c.tag from public.category_tag_groups c
           where c.retired_at is null and c.id not in (select id from item168_backup.category_tag_groups) order by c.tag loop
    v_impact := _taxonomy_impact('retire', r.id, null, null, null, true);
    if jsonb_array_length(coalesce(v_impact->'blockers', '[]'::jsonb)) > 0 then
      raise exception 'Item 168 rollback: retiring % is blocked: %', r.tag, v_impact->'blockers';
    end if;
    v_res := _taxonomy_apply('retire', r.tag, null, null, null, true, v_reason, v_impact->>'impact_token',
                             md5('item168-rollback:retire:' || r.tag)::uuid);
  end loop;
end $$;

-- 2d. Customer-only cleared (audited by the current record trigger as customer_only_changed), before the column goes.
select set_config('app.taxonomy_reason', 'Item 168 rollback (owner-ordered): customer-only marker removed', true);
update public.category_tag_groups set customer_only = false where customer_only;
select set_config('app.taxonomy_reason', '', true);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Data back to the snapshot. Rows created after the pass have no pre-image: their sports_fitness key folds back into
--    activities_recreation (a business with a primary tag was already re-paired by the engine in step 2b).
-- ---------------------------------------------------------------------------------------------------------------------
update public.brand_partners p set category = b.category
  from item168_backup.brand_partners b where b.id = p.id and p.category is distinct from b.category;
update public.brand_partners set category = 'activities_recreation'
 where category = 'sports_fitness' and id not in (select id from item168_backup.brand_partners);
update public.business_partner_requests p set category = b.category
  from item168_backup.business_partner_requests b where b.id = p.id and p.category is distinct from b.category;
update public.business_partner_requests set category = 'activities_recreation'
 where category = 'sports_fitness' and id not in (select id from item168_backup.business_partner_requests);

update public.profiles p set interest_groups = b.interest_groups
  from item168_backup.profile_interest_groups b where b.id = p.id and p.interest_groups is distinct from b.interest_groups;
update public.profiles set interest_groups = array(select distinct case when g = 'sports_fitness' then 'activities_recreation' else g end
                                                   from unnest(interest_groups) g)
 where 'sports_fitness' = any (interest_groups);

-- Aliases back to the snapshot (an alias saved after the pass keeps its phrase; only a sports_fitness key folds back).
update public.category_aliases a set category = b.category, subcategory = b.subcategory
  from item168_backup.category_aliases b
 where b.phrase = a.phrase and (a.category, a.subcategory) is distinct from (b.category, b.subcategory);
update public.category_aliases set category = 'activities_recreation' where category = 'sports_fitness';
-- Synonyms: exactly the snapshot's rows (the pass's 29 rows go; nothing else had changed).
delete from public.category_synonyms s
 where not exists (select 1 from item168_backup.category_synonyms b where b.phrase = s.phrase and b.tag = s.tag);
insert into public.category_synonyms select * from item168_backup.category_synonyms b
 where not exists (select 1 from public.category_synonyms s where s.phrase = b.phrase and s.tag = b.tag);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Code objects back to their exact pre-apply text; then the customer-only column and its CHECK go.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare f record; c record;
begin
  for f in select def from item168_backup.functions loop execute f.def; end loop;
  for c in select tbl, name, def from item168_backup.constraints where name <> 'category_taxonomy_changes_change_type_check' loop
    execute format('alter table %s drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table %s add constraint %I %s', c.tbl, c.name, c.def);
  end loop;
end $$;

alter table public.category_tag_groups drop constraint if exists category_tag_groups_one_side;
alter table public.category_tag_groups drop column if exists customer_only;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Postconditions: the pre-apply state, except what the header says is knowingly kept.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad text; n int; c record;
begin
  select string_agg(b.tag, ', ') into v_bad from item168_backup.category_tag_groups b join public.category_tag_groups g using (id)
   where (g.tag, g.group_key, g.key, g.business_only, g.retired_at is not null) is distinct from (b.tag, b.group_key, b.key, b.business_only, b.retired);
  if v_bad is not null then raise exception 'Item 168 rollback postcondition: taxonomy rows differ from the snapshot: %', v_bad; end if;
  select count(*) into n from public.category_tag_groups where retired_at is null and id not in (select id from item168_backup.category_tag_groups);
  if n > 0 then raise exception 'Item 168 rollback postcondition: % added categories still live.', n; end if;
  if (select count(*) from public.category_tag_groups where retired_at is null) <> (select count(*) from item168_backup.category_tag_groups where not retired) then
    raise exception 'Item 168 rollback postcondition: live tag count differs from the snapshot.';
  end if;
  if 'sports_fitness' = any (public.category_major_keys()) or not ('stay_getaway' = any (public.category_major_keys())) then
    raise exception 'Item 168 rollback postcondition: group keys are not the pre-apply set.';
  end if;
  for c in select f.name, f.def, pg_get_functiondef(p.oid) as now_def from item168_backup.functions f
           join pg_proc p on p.proname = f.name and pg_get_function_identity_arguments(p.oid) = f.args
           join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public' loop
    if c.def <> c.now_def then raise exception 'Item 168 rollback postcondition: function % differs from the snapshot.', c.name; end if;
  end loop;
  if exists (select 1 from item168_backup.constraints b where b.name <> 'category_taxonomy_changes_change_type_check'
              and not exists (select 1 from pg_constraint k where k.conname = b.name and pg_get_constraintdef(k.oid) = b.def)) then
    raise exception 'Item 168 rollback postcondition: a CHECK constraint differs from the snapshot.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'category_tag_groups' and column_name = 'customer_only')
     or to_regproc('public._enforce_business_category_rules') is not null then
    raise exception 'Item 168 rollback postcondition: customer_only column or the enforcement function remains.';
  end if;
  if exists (select 1 from item168_backup.brand_partners b join public.brand_partners p using (id) where p.category is distinct from b.category)
     or exists (select 1 from item168_backup.business_partner_requests b join public.business_partner_requests p using (id) where p.category is distinct from b.category)
     or exists (select 1 from item168_backup.profile_interest_groups b join public.profiles p using (id) where p.interest_groups is distinct from b.interest_groups) then
    raise exception 'Item 168 rollback postcondition: a stored group key differs from the snapshot.';
  end if;
  if exists (select 1 from item168_backup.category_aliases b join public.category_aliases a using (phrase)
              where (a.category, a.subcategory) is distinct from (b.category, b.subcategory)) then
    raise exception 'Item 168 rollback postcondition: an alias differs from the snapshot.';
  end if;
  if exists (select phrase, tag from public.category_synonyms except select phrase, tag from item168_backup.category_synonyms)
     or exists (select phrase, tag from item168_backup.category_synonyms except select phrase, tag from public.category_synonyms) then
    raise exception 'Item 168 rollback postcondition: synonyms differ from the snapshot.';
  end if;
end $$;

select 'Item 168 rollback OK' as result,
       (select count(*) from public.category_tag_groups where retired_at is null) as live_tags,
       cardinality(public.category_major_keys()) as groups,
       (select version from public.category_taxonomy_version) as taxonomy_version;
