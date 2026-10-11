-- Item 168, pre-apply snapshot for the rollback (scripts/rollback/20270294_v1_category_pass.rollback.sql).
-- Run ONCE, committed, immediately before migration 20270294 (runbook: PRODUCT_AUDIT/ITEM_168_MIGRATION_RUNBOOK_2026-10-11.md).
-- It copies only what the migration changes and the canonical engine cannot put back on its own: the stored group key of
-- every business / application / remembered alias, profile interest groups, the synonym table, and the exact text of every
-- function and CHECK constraint the migration redefines. The taxonomy rows themselves are reversed through the engine
-- (audited), so their pre-image is kept only to prove the rollback. Private schema: no grant to anon/authenticated.
-- Refuses to overwrite an existing snapshot or to run after the migration.
do $$
begin
  if to_regnamespace('item168_backup') is not null then
    raise exception 'Item 168 snapshot: schema item168_backup already exists (keep the first snapshot; drop it by hand only after sign-off).';
  end if;
  if 'sports_fitness' = any (public.category_major_keys()) then
    raise exception 'Item 168 snapshot: migration 20270294 is already applied; a snapshot now would not be a pre-image.';
  end if;
end $$;

create schema item168_backup;
revoke all on schema item168_backup from public, anon, authenticated;

create table item168_backup.taken (taken_at timestamptz not null default now(), taxonomy_version bigint not null);
insert into item168_backup.taken (taxonomy_version) select version from public.category_taxonomy_version;

create table item168_backup.category_tag_groups as
  select id, tag, group_key, key, business_only, retired_at is not null as retired, replaced_by from public.category_tag_groups;
create table item168_backup.category_synonyms as select * from public.category_synonyms;
create table item168_backup.category_aliases as select * from public.category_aliases;
create table item168_backup.brand_partners as select id, category, subcategory, categories from public.brand_partners;
create table item168_backup.business_partner_requests as select id, category, subcategory, categories from public.business_partner_requests;
create table item168_backup.profile_interest_groups as
  select id, interest_groups from public.profiles where interest_groups is not null and cardinality(interest_groups) > 0;

create table item168_backup.functions as
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('_taxonomy_record_update', 'get_category_taxonomy', 'category_major_keys', 'update_business_profile', 'business_served_tags');
create table item168_backup.constraints as
  select conrelid::regclass::text as tbl, conname as name, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conname in ('brand_partners_category_check', 'business_partner_requests_category_check', 'gatherings_format_check',
                    'category_taxonomy_changes_change_type_check');

do $$
begin
  if (select count(*) from item168_backup.functions) <> 5 then raise exception 'Item 168 snapshot: expected 5 functions.'; end if;
  if (select count(*) from item168_backup.constraints) <> 4 then raise exception 'Item 168 snapshot: expected 4 constraints.'; end if;
end $$;

select (select count(*) from item168_backup.category_tag_groups) as tags,
       (select count(*) from item168_backup.brand_partners) as businesses,
       (select count(*) from item168_backup.business_partner_requests) as applications,
       (select taxonomy_version from item168_backup.taken) as taxonomy_version;
