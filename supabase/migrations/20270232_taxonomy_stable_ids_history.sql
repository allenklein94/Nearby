-- Taxonomy foundation, Option 1 (owner decision 2026-09-27): stable IDs + versioned, auditable history.
--
-- Every leaf tag in public.category_tag_groups gets a permanent numeric ID that never changes and is never reused.
-- Existing storage stays NAME-based (tag text in ~20 columns); the ID is the identity, the name is the display name and
-- the legacy storage key. Nothing here converts a stored field to IDs.
--
--   category_tag_groups.id            permanent ID (sequence; immutable; rows are never deleted)
--   category_tag_groups.retired_at    retired tags keep their row, ID, name and history; they cannot be newly chosen
--   category_tag_groups.replaced_by   a retirement that merged into another tag
--   category_taxonomy_version         ONE version number, bumped only when a real change commits
--   category_taxonomy_changes         append-only audit log (added/renamed/moved/retired/restored/business_only_changed)
--   category_tag_former_names         every name an ID used to have (a name maps to exactly one ID forever)
--   category_tag_references           the registry of every column that stores a tag NAME (fk / unlinked / historical)
--
-- ONE canonical mutation path: admin_rename_category_tag / admin_move_category_tag / admin_retire_category_tag /
-- admin_restore_category_tag, each gated on is_admin server-side, each REQUIRING a preview first
-- (admin_preview_category_change): the change is checked against existing data, synonyms and matching behavior, and the
-- mutation only commits with the preview's impact token (so a rename cannot be committed blind, or after the data moved).
-- A direct UPDATE of tag/group/retirement is refused unless it comes through those functions. Adding a tag keeps its
-- existing paths (admin_add_category_tag, emerging categories, migrations); triggers record every add.
--
-- Safe to rerun: every step is guarded (if not exists / only fills missing IDs / on conflict do nothing).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Stable IDs
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.category_tag_groups add column if not exists id bigint;
alter table public.category_tag_groups add column if not exists retired_at timestamptz;
alter table public.category_tag_groups add column if not exists retired_by uuid;
alter table public.category_tag_groups add column if not exists replaced_by bigint;

-- Deterministic assignment for rows that have none yet: case-insensitive name order, after the current maximum.
with numbered as (
  select tag, (select coalesce(max(id), 0) from public.category_tag_groups)
              + row_number() over (order by lower(tag), tag) as n
  from public.category_tag_groups where id is null
)
update public.category_tag_groups g set id = numbered.n from numbered where g.tag = numbered.tag;

create sequence if not exists public.category_tag_id_seq;
-- Never move the sequence backwards (a rerun must not hand out an ID again).
select setval('public.category_tag_id_seq',
              greatest((select coalesce(max(id), 1) from public.category_tag_groups),
                       (select last_value from public.category_tag_id_seq)));

alter table public.category_tag_groups alter column id set default nextval('public.category_tag_id_seq');
alter table public.category_tag_groups alter column id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'category_tag_groups_id_key') then
    alter table public.category_tag_groups add constraint category_tag_groups_id_key unique (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'category_tag_groups_replaced_by_fkey') then
    alter table public.category_tag_groups add constraint category_tag_groups_replaced_by_fkey
      foreign key (replaced_by) references public.category_tag_groups (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'category_tag_groups_retirement_check') then
    alter table public.category_tag_groups add constraint category_tag_groups_retirement_check
      check ((replaced_by is null or retired_at is not null) and replaced_by is distinct from id);
  end if;
end $$;
-- One name per ID regardless of case (the admin path already refused case-insensitive duplicates).
create unique index if not exists category_tag_groups_lower_tag_key on public.category_tag_groups (lower(tag));

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Version, history, former names, reference registry
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.category_taxonomy_version (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);
insert into public.category_taxonomy_version (singleton) values (true) on conflict do nothing;

create table if not exists public.category_taxonomy_changes (
  id bigserial primary key,
  tag_id bigint not null references public.category_tag_groups (id),
  change_type text not null check (change_type in ('added', 'renamed', 'moved', 'retired', 'restored', 'business_only_changed')),
  old_name text,
  new_name text,
  old_group text,
  new_group text,
  replaced_by bigint references public.category_tag_groups (id),
  taxonomy_version bigint not null,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'migration')),
  reason text,
  request_id uuid,
  impact jsonb,
  created_at timestamptz not null default now()
);
create index if not exists category_taxonomy_changes_tag_idx on public.category_taxonomy_changes (tag_id, id);
create index if not exists category_taxonomy_changes_request_idx on public.category_taxonomy_changes (request_id) where request_id is not null;

create table if not exists public.category_tag_former_names (
  name text primary key,
  tag_id bigint not null references public.category_tag_groups (id),
  created_at timestamptz not null default now()
);
create unique index if not exists category_tag_former_names_lower_key on public.category_tag_former_names (lower(name));

-- Every column that stores a tag NAME. kind: fk = FK to category_tag_groups(tag), ON UPDATE CASCADE does the rename;
-- unlinked = plain text / text[] the canonical path rewrites itself; historical = logs of what was asked at the time,
-- never rewritten (a former name still resolves through category_tag_former_names). group_column = the paired "major"
-- column that must stay the tag's group.
create table if not exists public.category_tag_references (
  table_name text not null,
  column_name text not null,
  is_array boolean not null,
  kind text not null check (kind in ('fk', 'unlinked', 'historical')),
  group_column text,
  normalize_on_write boolean not null default true,
  note text not null,
  primary key (table_name, column_name)
);
insert into public.category_tag_references (table_name, column_name, is_array, kind, group_column, normalize_on_write, note) values
  ('brand_partners',            'subcategory',            false, 'fk',        'category', true,  'business primary tag'),
  ('business_partner_requests', 'subcategory',            false, 'fk',        'category', true,  'application primary tag'),
  ('business_requests',         'category',               false, 'fk',        null,       true,  'request category (routing)'),
  ('business_availability',     'category',               false, 'fk',        null,       true,  'availability posting category'),
  ('business_priority_signals', 'category',               false, 'fk',        null,       true,  'business boost category'),
  ('category_synonyms',         'tag',                    false, 'fk',        null,       true,  'search synonym target'),
  ('gatherings',                'interest_tag',           false, 'unlinked',  null,       true,  'gathering category'),
  ('communities',               'interest_tag',           false, 'unlinked',  null,       true,  'community category'),
  ('brand_offers',              'target_interest_tag',    false, 'unlinked',  null,       true,  'perk target interest'),
  ('category_aliases',          'subcategory',            false, 'unlinked',  'category', true,  'remembered signup phrase mapping'),
  ('date_proposals',            'category',               false, 'unlinked',  null,       true,  'date plan category'),
  ('group_plan_proposals',      'category',               false, 'unlinked',  null,       true,  'group plan category'),
  ('plan_stops',                'category',               false, 'unlinked',  null,       false, 'experience stop (snapshot of a posting)'),
  ('behavior_events',           'category',               false, 'unlinked',  null,       false, 'private behavior affinity'),
  ('profiles',                  'interests',              true,  'unlinked',  null,       true,  'declared interests'),
  ('profiles',                  'monthly_interests',      true,  'unlinked',  null,       true,  'this month''s interests'),
  ('profiles',                  'notify_things_to_do_categories',        true, 'unlinked', null, true, 'notification category filter'),
  ('profiles',                  'notify_nearby_opportunities_categories', true, 'unlinked', null, true, 'notification category filter'),
  ('brand_partners',            'categories',             true,  'unlinked',  null,       true,  'business secondary tags'),
  ('business_partner_requests', 'categories',             true,  'unlinked',  null,       true,  'application secondary tags'),
  ('business_requests',         'shared_interests',       true,  'unlinked',  null,       true,  'legacy shared interests on a request'),
  ('intent_submissions',        'category',               false, 'historical', null,      false, 'search log (as asked)'),
  ('intent_outcomes',           'category',               false, 'historical', null,      false, 'search outcome log (as asked)')
on conflict (table_name, column_name) do nothing;

alter table public.category_taxonomy_version enable row level security;
alter table public.category_taxonomy_changes enable row level security;
alter table public.category_tag_former_names enable row level security;
alter table public.category_tag_references enable row level security;
revoke all on public.category_taxonomy_version, public.category_taxonomy_changes, public.category_tag_former_names,
              public.category_tag_references from public, anon, authenticated;
revoke all on sequence public.category_tag_id_seq from public, anon, authenticated;
revoke all on sequence public.category_taxonomy_changes_id_seq from public, anon, authenticated;
-- The taxonomy table itself stays readable (the app reads it) and is never client-writable.
revoke insert, update, delete, truncate on public.category_tag_groups from public, anon, authenticated;

-- Baseline: every existing tag gets its origin entry at version 1 (only tags that have none yet).
insert into public.category_taxonomy_changes (tag_id, change_type, new_name, new_group, taxonomy_version, actor_kind, reason, created_at)
select g.id, 'added', g.tag, g.group_key, 1, 'migration', 'Baseline: stable ID assigned (migration 20270232)', g.created_at
from public.category_tag_groups g
where not exists (select 1 from public.category_taxonomy_changes c where c.tag_id = g.id);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Guards and automatic history on category_tag_groups
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._taxonomy_bump_version()
returns bigint language sql security definer set search_path = public as $$
  update category_taxonomy_version set version = version + 1, updated_at = now() where singleton returning version;
$$;

create or replace function public._taxonomy_append_only()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only.', TG_TABLE_NAME;
end $$;

drop trigger if exists append_only on public.category_taxonomy_changes;
create trigger append_only before update or delete on public.category_taxonomy_changes
  for each row execute function public._taxonomy_append_only();
drop trigger if exists append_only_truncate on public.category_taxonomy_changes;
create trigger append_only_truncate before truncate on public.category_taxonomy_changes
  for each statement execute function public._taxonomy_append_only();
drop trigger if exists append_only on public.category_tag_former_names;
create trigger append_only before update or delete on public.category_tag_former_names
  for each row execute function public._taxonomy_append_only();

create or replace function public._taxonomy_guard_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'A category is never deleted. Retire it instead (admin_retire_category_tag).';
  end if;
  if TG_OP = 'INSERT' then
    NEW.id := nextval('public.category_tag_id_seq');   -- IDs come only from the sequence: never chosen, never reused
    NEW.retired_at := null; NEW.retired_by := null; NEW.replaced_by := null;
    if exists (select 1 from category_tag_former_names f where lower(f.name) = lower(NEW.tag)) then
      raise exception 'That name belonged to another category and cannot be reused.';
    end if;
    return NEW;
  end if;
  -- UPDATE
  if NEW.id is distinct from OLD.id then
    raise exception 'A category ID never changes.';
  end if;
  if (NEW.tag, NEW.group_key, NEW.retired_at is null, NEW.replaced_by)
       is distinct from (OLD.tag, OLD.group_key, OLD.retired_at is null, OLD.replaced_by)
     and coalesce(current_setting('app.taxonomy_mutation', true), '') <> 'on' then
    raise exception 'Category changes go through admin_rename_category_tag, admin_move_category_tag, admin_retire_category_tag or admin_restore_category_tag.';
  end if;
  if NEW.tag <> OLD.tag and exists (select 1 from category_tag_former_names f
                                    where lower(f.name) = lower(NEW.tag) and f.tag_id <> NEW.id) then
    raise exception 'That name belonged to another category and cannot be reused.';
  end if;
  return NEW;
end $$;

drop trigger if exists taxonomy_guard_row on public.category_tag_groups;
create trigger taxonomy_guard_row before insert or update or delete on public.category_tag_groups
  for each row execute function public._taxonomy_guard_row();

create or replace function public._taxonomy_guard_truncate()
returns trigger language plpgsql as $$
begin
  raise exception 'A category is never deleted. Retire it instead (admin_retire_category_tag).';
end $$;
drop trigger if exists taxonomy_guard_truncate on public.category_tag_groups;
create trigger taxonomy_guard_truncate before truncate on public.category_tag_groups
  for each statement execute function public._taxonomy_guard_truncate();

create or replace function public._taxonomy_actor_kind()
returns text language sql stable as $$ select case when auth.uid() is null then 'migration' else 'admin' end $$;

create or replace function public._taxonomy_record_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ver bigint;
begin
  if not exists (select 1 from new_rows) then return null; end if;
  v_ver := _taxonomy_bump_version();
  insert into category_taxonomy_changes (tag_id, change_type, new_name, new_group, taxonomy_version, actor_id, actor_kind,
                                         reason, request_id, impact)
  select n.id, 'added', n.tag, n.group_key, v_ver, auth.uid(), _taxonomy_actor_kind(),
         nullif(current_setting('app.taxonomy_reason', true), ''),
         nullif(current_setting('app.taxonomy_request_id', true), '')::uuid,
         nullif(current_setting('app.taxonomy_impact', true), '')::jsonb
  from new_rows n;
  return null;
end $$;

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
    where (o.tag, o.group_key, o.retired_at is null, o.replaced_by, o.business_only)
          is distinct from (n.tag, n.group_key, n.retired_at is null, n.replaced_by, n.business_only)
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
    ('business_only_changed', n.tag, n.tag, n.group_key, n.group_key, null::bigint, o.business_only is distinct from n.business_only)
  ) as x(change_type, old_name, new_name, old_group, new_group, replaced_by, happened)
  where x.happened;
  return null;
end $$;

drop trigger if exists taxonomy_record_insert on public.category_tag_groups;
create trigger taxonomy_record_insert after insert on public.category_tag_groups
  referencing new table as new_rows for each statement execute function public._taxonomy_record_insert();
drop trigger if exists taxonomy_record_update on public.category_tag_groups;
create trigger taxonomy_record_update after update on public.category_tag_groups
  referencing old table as old_rows new table as new_rows for each statement execute function public._taxonomy_record_update();

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Name resolution (the canonical lookup) and write-time normalization of legacy names
-- ---------------------------------------------------------------------------------------------------------------------
-- The ID a name belongs to: a current name first, else a former name. Case-insensitive; NULL = not a category name.
create or replace function public._taxonomy_id_for_name(name_param text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select g.id from category_tag_groups g where lower(g.tag) = lower(btrim(name_param))),
    (select f.tag_id from category_tag_former_names f where lower(f.name) = lower(btrim(name_param)))
  );
$$;

-- Where a stored/written name should point NOW: follows retirement merges (bounded) to the live tag.
-- Returns (tag_id, current_tag, retired). retired = true only when the chain ends at a retired tag with no replacement.
create or replace function public._taxonomy_live_target(tag_id_param bigint)
returns table (tag_id bigint, current_tag text, retired boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_id bigint := tag_id_param; v_row record; i int := 0;
begin
  loop
    select g.id, g.tag, g.retired_at, g.replaced_by into v_row from category_tag_groups g where g.id = v_id;
    if not found then return; end if;
    if v_row.retired_at is null or v_row.replaced_by is null or i >= 10 then
      tag_id := v_row.id; current_tag := v_row.tag; retired := v_row.retired_at is not null;
      return next; return;
    end if;
    v_id := v_row.replaced_by; i := i + 1;
  end loop;
end $$;

-- BEFORE INSERT/UPDATE OF the registered columns: a former name (old app, cached draft, static web form) is written as
-- its CURRENT name; a name retired into a replacement is written as the replacement; a retired name with no replacement
-- is refused only when it is NEWLY introduced (rows that already carried it keep it). Fast path when nothing was ever
-- renamed or retired. Arguments: the column names.
create or replace function public._taxonomy_normalize_tags()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end;
  v_patch jsonb := '{}'::jsonb;
  v_col text;
  v_val jsonb;
  v_elem text;
  v_out text[];
  v_old_elems text[];
  v_id bigint;
  v_t record;
  i int;
begin
  if not exists (select 1 from category_tag_former_names)
     and not exists (select 1 from category_tag_groups where retired_at is not null) then
    return NEW;
  end if;
  for i in 0 .. TG_NARGS - 1 loop
    v_col := TG_ARGV[i];
    v_val := v_new -> v_col;
    if v_val is null or jsonb_typeof(v_val) = 'null' then continue; end if;
    if TG_OP = 'UPDATE' and v_val = (v_old -> v_col) then continue; end if;
    if jsonb_typeof(v_val) = 'array' then
      v_old_elems := case when TG_OP = 'UPDATE' and jsonb_typeof(v_old -> v_col) = 'array'
                          then array(select jsonb_array_elements_text(v_old -> v_col)) else array[]::text[] end;
      v_out := array[]::text[];
      for v_elem in select jsonb_array_elements_text(v_val) loop
        v_id := _taxonomy_id_for_name(v_elem);
        if v_id is not null then
          select * into v_t from _taxonomy_live_target(v_id);
          if v_t.retired and not (v_elem = any (v_old_elems)) then
            raise exception '"%" has been retired and can no longer be chosen.', v_elem using hint = 'category_retired';
          end if;
          if not v_t.retired or not (v_elem = any (v_old_elems)) then v_elem := v_t.current_tag; end if;
        end if;
        if not (v_elem = any (v_out)) then v_out := v_out || v_elem; end if;
      end loop;
      v_patch := v_patch || jsonb_build_object(v_col, to_jsonb(v_out));
    elsif jsonb_typeof(v_val) = 'string' then
      v_elem := v_val #>> '{}';
      v_id := _taxonomy_id_for_name(v_elem);
      if v_id is not null then
        select * into v_t from _taxonomy_live_target(v_id);
        if v_t.retired then
          raise exception '"%" has been retired and can no longer be chosen.', v_elem using hint = 'category_retired';
        end if;
        v_patch := v_patch || jsonb_build_object(v_col, v_t.current_tag);
      end if;
    end if;
  end loop;
  if v_patch <> '{}'::jsonb then
    NEW := jsonb_populate_record(NEW, v_patch);
  end if;
  return NEW;
end $$;
revoke all on function public._taxonomy_normalize_tags() from public, anon, authenticated;

-- Attach it to every registered column marked normalize_on_write, one trigger per table. Named "a_..." so it runs before
-- the other BEFORE triggers (business-only check, tag-array validation); FK checks run after all of them.
do $$
declare r record;
begin
  for r in select table_name, string_agg(format('%I', column_name), ', ' order by column_name) as cols,
                  string_agg(quote_literal(column_name), ', ' order by column_name) as args
           from public.category_tag_references where normalize_on_write group by table_name loop
    execute format('drop trigger if exists a_taxonomy_normalize_tags on public.%I', r.table_name);
    execute format('create trigger a_taxonomy_normalize_tags before insert or update of %s on public.%I
                    for each row execute function public._taxonomy_normalize_tags(%s)', r.cols, r.table_name, r.args);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Impact analysis (the safeguard) and the dependent rewrites
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._taxonomy_array_replace(arr text[], old_val text, new_val text)
returns text[] language sql immutable as $$
  select case when arr is null then null else coalesce((
    select array_agg(v order by first_ord) from (
      select v, min(ord) as first_ord from unnest(array_replace(arr, old_val, new_val)) with ordinality u(v, ord) group by v
    ) d), array[]::text[]) end;
$$;

-- Rows that reference a name, per registered column.
create or replace function public._taxonomy_reference_counts(name_param text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; n bigint; v_out jsonb := '[]'::jsonb;
begin
  for r in select * from category_tag_references order by kind, table_name, column_name loop
    if r.is_array then
      execute format('select count(*) from public.%I where $1 = any(%I)', r.table_name, r.column_name) into n using name_param;
    else
      execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name) into n using name_param;
    end if;
    if n > 0 then
      v_out := v_out || jsonb_build_object('table', r.table_name, 'column', r.column_name, 'kind', r.kind, 'rows', n);
    end if;
  end loop;
  return v_out;
end $$;

-- Rewrite every live (fk + unlinked) reference from one name to another. FK columns are included only when asked
-- (a rename lets ON UPDATE CASCADE do them; a merge into another tag must rewrite them itself).
create or replace function public._taxonomy_rewrite_references(old_param text, new_param text, include_fk boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n bigint; v_out jsonb := '{}'::jsonb;
begin
  for r in select * from category_tag_references
           where kind = 'unlinked' or (include_fk and kind = 'fk') order by table_name, column_name loop
    if r.is_array then
      execute format('update public.%I set %I = public._taxonomy_array_replace(%I, $1, $2) where $1 = any(%I)',
                     r.table_name, r.column_name, r.column_name, r.column_name) using old_param, new_param;
    else
      execute format('update public.%I set %I = $2 where %I = $1', r.table_name, r.column_name, r.column_name)
        using old_param, new_param;
    end if;
    get diagnostics n = row_count;
    if n > 0 then v_out := v_out || jsonb_build_object(r.table_name || '.' || r.column_name, n); end if;
  end loop;
  return v_out;
end $$;

-- Keep a paired major column equal to the tag's group for rows whose primary tag is `tag_param`.
create or replace function public._taxonomy_sync_group_columns(tag_param text, group_param text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n bigint; v_out jsonb := '{}'::jsonb;
begin
  for r in select * from category_tag_references where group_column is not null and not is_array loop
    execute format('update public.%I set %I = $2 where %I = $1 and %I is distinct from $2',
                   r.table_name, r.group_column, r.column_name, r.group_column) using tag_param, group_param;
    get diagnostics n = row_count;
    if n > 0 then v_out := v_out || jsonb_build_object(r.table_name || '.' || r.group_column, n); end if;
  end loop;
  return v_out;
end $$;

-- What a change would do, checked against existing data, synonyms and matching behavior. Blockers stop the change;
-- warnings are what the admin must accept. impact_token binds the later commit to exactly this state.
create or replace function public._taxonomy_impact(action_param text, tag_id_param bigint, new_name_param text,
                                                   new_group_param text, replacement_id_param bigint,
                                                   keep_existing_param boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g record;
  rep record;
  v_version bigint;
  v_blockers text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_refs jsonb;
  v_live_rows bigint;
  v_hist_rows bigint;
  v_matching jsonb := '{}'::jsonb;
  v_syn jsonb;
  v_noop boolean := false;
  v_name text := regexp_replace(btrim(coalesce(new_name_param, '')), '\s+', ' ', 'g');
  v_key text;
  v_target_group text;
  n bigint;
begin
  select * into rep from category_tag_groups where false;   -- an empty record, so rep.id reads as null when unused
  select version into v_version from category_taxonomy_version where singleton;
  select * into g from category_tag_groups where id = tag_id_param;
  if not found then
    return jsonb_build_object('blockers', jsonb_build_array('Unknown category'), 'noop', false);
  end if;

  v_refs := _taxonomy_reference_counts(g.tag);
  select coalesce(sum((e->>'rows')::bigint) filter (where e->>'kind' <> 'historical'), 0),
         coalesce(sum((e->>'rows')::bigint) filter (where e->>'kind' = 'historical'), 0)
    into v_live_rows, v_hist_rows from jsonb_array_elements(v_refs) e;
  select jsonb_build_object('count', count(*), 'phrases', coalesce(jsonb_agg(phrase order by phrase), '[]'::jsonb))
    into v_syn from category_synonyms where tag = g.tag;

  if action_param = 'rename' then
    if v_name = g.tag then
      v_noop := true;
    else
      if g.retired_at is not null then v_blockers := v_blockers || text 'A retired category cannot be renamed. Restore it first.'; end if;
      if char_length(v_name) < 2 or char_length(v_name) > 40 or v_name !~ '^[A-Za-z0-9][A-Za-z0-9 &''/-]*$' then
        v_blockers := v_blockers || text 'A category name is 2-40 characters: letters, numbers, spaces and & / - only';
      end if;
      if exists (select 1 from category_tag_groups where lower(tag) = lower(v_name) and id <> g.id) then
        v_blockers := v_blockers || text 'Another category (current or retired) already has that name.';
      end if;
      if exists (select 1 from category_tag_former_names where lower(name) = lower(v_name) and tag_id <> g.id) then
        v_blockers := v_blockers || text 'That name belonged to another category and cannot be reused.';
      end if;
      v_key := _category_search_key(v_name);
      if exists (select 1 from category_synonyms where phrase = v_key and tag <> g.tag) then
        v_blockers := v_blockers || format('"%s" is already a search synonym of %s; a category''s own name may only mean itself.',
                                           v_name, (select tag from category_synonyms where phrase = v_key));
      end if;
      if exists (select 1 from category_tag_groups where id <> g.id and _category_search_key(tag) = v_key) then
        v_blockers := v_blockers || text 'That name searches the same as another category.';
      end if;
      if exists (select 1 from category_aliases where lower(phrase) = lower(v_name) and subcategory is distinct from g.tag) then
        v_warnings := v_warnings || text 'A remembered signup phrase with this wording points to a different category.';
      end if;
      v_matching := jsonb_build_object(
        'old_name_becomes_synonym', not exists (select 1 from category_synonyms where phrase = _category_search_key(g.tag)),
        'rows_renamed', v_live_rows,
        'historical_rows_kept', v_hist_rows);
      if v_live_rows > 0 then
        v_warnings := v_warnings || format('%s stored references move to the new name in the same transaction.', v_live_rows);
      end if;
      v_warnings := v_warnings || text 'Search keeps finding the old wording: it becomes a synonym of the new name.';
      v_warnings := v_warnings || text 'Installed apps show the new name after their next sign-in refresh; older app versions write the old name, which is saved as the new one.';
    end if;

  elsif action_param = 'move' then
    if new_group_param is null or not (new_group_param = any (category_major_keys())) then
      v_blockers := v_blockers || text 'Unknown category group';
    elsif new_group_param = g.group_key then
      v_noop := true;
    else
      if g.retired_at is not null then v_blockers := v_blockers || text 'A retired category cannot be moved. Restore it first.'; end if;
      v_matching := jsonb_build_object(
        'businesses_major_changes', (select count(*) from brand_partners where subcategory = g.tag and category is distinct from new_group_param),
        'applications_major_changes', (select count(*) from business_partner_requests where subcategory = g.tag and category is distinct from new_group_param),
        'aliases_major_changes', (select count(*) from category_aliases where subcategory = g.tag and category is distinct from new_group_param),
        'major_only_businesses_stop_serving', (select count(*) from brand_partners where category = g.group_key and subcategory is null and coalesce(cardinality(categories), 0) = 0),
        'major_only_businesses_start_serving', (select count(*) from brand_partners where category = new_group_param and subcategory is null and coalesce(cardinality(categories), 0) = 0),
        'open_requests_rerouted', (select count(*) from business_requests where category = g.tag and status = 'open'),
        'rows_with_the_tag', v_live_rows);
      v_warnings := v_warnings || format('Businesses whose main type is %s get %s as their major: %s.', g.tag, new_group_param,
                                         v_matching->>'businesses_major_changes');
      v_warnings := v_warnings || format('Open requests in %s are routed within %s from now on: %s.', g.tag, new_group_param,
                                         v_matching->>'open_requests_rerouted');
      v_warnings := v_warnings || format('Businesses that declared only a major stop/start serving this tag: %s / %s.',
                                         v_matching->>'major_only_businesses_stop_serving', v_matching->>'major_only_businesses_start_serving');
    end if;

  elsif action_param = 'retire' then
    if replacement_id_param is not null then
      select * into rep from category_tag_groups where id = replacement_id_param;
    end if;
    if g.retired_at is not null then
      if g.replaced_by is not distinct from replacement_id_param then
        v_noop := true;
      else
        v_blockers := v_blockers || text 'Already retired. Restore it first to change how it was retired.';
      end if;
    elsif replacement_id_param is not null and rep.id is null then
      v_blockers := v_blockers || text 'Unknown replacement category';
    elsif replacement_id_param is not null and rep.id = g.id then
      v_blockers := v_blockers || text 'A category cannot replace itself.';
    elsif replacement_id_param is not null and rep.retired_at is not null then
      v_blockers := v_blockers || text 'The replacement is itself retired.';
    elsif replacement_id_param is not null and rep.business_only and not g.business_only then
      v_blockers := v_blockers || text 'A consumer category cannot be merged into a business-only one (people''s interests would become business-only).';
    else
      if replacement_id_param is null then
        if v_live_rows > 0 and not coalesce(keep_existing_param, false) then
          v_blockers := v_blockers || format('%s rows still use %s. Choose a replacement, or explicitly keep them on the retired name.',
                                             v_live_rows, g.tag);
        end if;
        v_matching := jsonb_build_object('rows_keep_retired_name', v_live_rows,
          'open_requests', (select count(*) from business_requests where category = g.tag and status = 'open'),
          'upcoming_gatherings', (select count(*) from gatherings where interest_tag = g.tag and scheduled_at > now()),
          'synonyms_kept', v_syn->'count');
        if v_live_rows > 0 then
          v_warnings := v_warnings || format('%s rows keep %s and still match on it; nobody can newly choose it.', v_live_rows, g.tag);
        end if;
      else
        v_target_group := rep.group_key;
        v_matching := jsonb_build_object('rows_moved_to_replacement', v_live_rows,
          'synonyms_moved', v_syn->'count',
          'businesses_major_changes', case when rep.group_key <> g.group_key
                                           then (select count(*) from brand_partners where subcategory = g.tag) else 0 end,
          'open_requests_rerouted', (select count(*) from business_requests where category = g.tag and status = 'open'));
        v_warnings := v_warnings || format('%s stored references and %s synonyms move to %s in the same transaction.',
                                           v_live_rows, v_syn->>'count', rep.tag);
        if rep.group_key <> g.group_key then
          v_warnings := v_warnings || format('%s is in another group (%s): businesses whose main type was %s get that major.',
                                             rep.tag, rep.group_key, g.tag);
        end if;
      end if;
      v_warnings := v_warnings || text 'The ID, name and history are kept; the name can never be given to another category.';
    end if;

  elsif action_param = 'restore' then
    if g.retired_at is null then
      v_noop := true;
    else
      if exists (select 1 from category_tag_groups where lower(tag) = lower(g.tag) and id <> g.id) then
        v_blockers := v_blockers || text 'Another category now has this name.';
      end if;
      if g.replaced_by is not null then
        v_warnings := v_warnings || text 'It was merged: its old references stay with the replacement and are not moved back.';
      end if;
      v_matching := jsonb_build_object('rows_with_the_tag', v_live_rows);
    end if;
  else
    v_blockers := v_blockers || text 'Unknown action';
  end if;

  return jsonb_build_object(
    'action', action_param,
    'tag', jsonb_build_object('id', g.id, 'name', g.tag, 'group', g.group_key, 'business_only', g.business_only,
                              'retired', g.retired_at is not null),
    'new_name', case when action_param = 'rename' then v_name end,
    'new_group', case when action_param = 'move' then new_group_param end,
    'replacement', case when rep.id is not null then jsonb_build_object('id', rep.id, 'name', rep.tag, 'group', rep.group_key) end,
    'keep_existing', case when action_param = 'retire' then coalesce(keep_existing_param, false) end,
    'noop', v_noop,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'references', v_refs,
    'synonyms', v_syn,
    'matching', v_matching,
    'taxonomy_version', v_version,
    'impact_token', md5(concat_ws('|', action_param, g.id, g.tag, g.group_key, g.retired_at is null, g.replaced_by, v_name,
                                  new_group_param, replacement_id_param, coalesce(keep_existing_param, false), v_version,
                                  v_refs::text, v_syn::text, v_matching::text)));
end $$;

-- A tag given to an admin function: a CURRENT name (case-insensitive) or its numeric ID. A former name is refused with
-- the current one named, so nobody edits "Mini golf" thinking it still exists.
create or replace function public._taxonomy_resolve_for_admin(tag_param text)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare v_id bigint; v_cur text;
begin
  if btrim(coalesce(tag_param, '')) ~ '^[0-9]+$' then
    select id into v_id from category_tag_groups where id = btrim(tag_param)::bigint;
  else
    select id into v_id from category_tag_groups where lower(tag) = lower(btrim(coalesce(tag_param, '')));
  end if;
  if v_id is null then
    select g.tag into v_cur from category_tag_former_names f join category_tag_groups g on g.id = f.tag_id
     where lower(f.name) = lower(btrim(coalesce(tag_param, '')));
    if v_cur is not null then
      raise exception '"%" is a former name. The category is now called "%".', tag_param, v_cur;
    end if;
    raise exception 'Unknown category';
  end if;
  return v_id;
end $$;

create or replace function public._taxonomy_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only an admin can change the taxonomy';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The canonical mutation path
-- ---------------------------------------------------------------------------------------------------------------------
-- One engine for all four changes. No grants: only the admin wrappers (and a migration running as the owner) call it.
create or replace function public._taxonomy_apply(action_param text, tag_param text, new_name_param text,
                                                  new_group_param text, replacement_param text, keep_existing_param boolean,
                                                  reason_param text, impact_token_param text, request_id_param uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expected text := case action_param when 'rename' then 'renamed' when 'move' then 'moved'
                                       when 'retire' then 'retired' when 'restore' then 'restored' end;
  v_prior record;
  v_id bigint;
  v_rep_id bigint;
  v_impact jsonb;
  v_version bigint;
  g record;
  rep record;
  v_new_name text;
  v_rows jsonb := '{}'::jsonb;
begin
  if v_expected is null then raise exception 'Unknown action'; end if;
  if request_id_param is null then
    raise exception 'A request id is required (it makes the change safe to retry).';
  end if;

  -- Serialize every taxonomy change behind the version row.
  perform 1 from category_taxonomy_version where singleton for update;

  -- Safe retry: the same request id returns the committed result instead of changing anything twice.
  select change_type, tag_id, taxonomy_version into v_prior
    from category_taxonomy_changes where request_id = request_id_param order by id limit 1;
  if found then
    if v_prior.change_type <> v_expected then
      raise exception 'That request id was already used for a different change.';
    end if;
    return jsonb_build_object('changed', true, 'replayed', true, 'tag_id', v_prior.tag_id,
                              'taxonomy_version', v_prior.taxonomy_version);
  end if;

  v_id := _taxonomy_resolve_for_admin(tag_param);
  if action_param = 'retire' and replacement_param is not null then
    v_rep_id := _taxonomy_resolve_for_admin(replacement_param);
  end if;
  select * into g from category_tag_groups where id = v_id for update;

  v_impact := _taxonomy_impact(action_param, v_id, new_name_param, new_group_param, v_rep_id, keep_existing_param);
  select version into v_version from category_taxonomy_version where singleton;
  if (v_impact->>'noop')::boolean then
    return jsonb_build_object('changed', false, 'noop', true, 'tag_id', v_id, 'taxonomy_version', v_version);
  end if;
  if jsonb_array_length(v_impact->'blockers') > 0 then
    raise exception '%', (select string_agg(b, E'\n') from jsonb_array_elements_text(v_impact->'blockers') b)
      using hint = 'taxonomy_blocked';
  end if;
  if char_length(btrim(coalesce(reason_param, ''))) < 10 then
    raise exception 'Say why this change is needed (at least 10 characters).';
  end if;
  if impact_token_param is distinct from v_impact->>'impact_token' then
    raise exception 'The taxonomy or its data changed since this change was previewed. Preview it again before committing.'
      using hint = 'taxonomy_stale_preview';
  end if;

  perform set_config('app.taxonomy_mutation', 'on', true);
  perform set_config('app.taxonomy_reason', btrim(reason_param), true);
  perform set_config('app.taxonomy_request_id', request_id_param::text, true);
  perform set_config('app.taxonomy_impact', v_impact::text, true);

  if action_param = 'rename' then
    v_new_name := v_impact->>'new_name';
    update category_tag_groups set tag = v_new_name where id = v_id;          -- FK columns follow (ON UPDATE CASCADE)
    v_rows := _taxonomy_rewrite_references(g.tag, v_new_name, false);         -- unlinked columns, same transaction
    -- The old wording keeps finding it in search (never displacing another category's own name: checked in the impact).
    insert into category_synonyms (phrase, tag) values (_category_search_key(g.tag), v_new_name) on conflict do nothing;

  elsif action_param = 'move' then
    update category_tag_groups set group_key = new_group_param where id = v_id;
    v_rows := _taxonomy_sync_group_columns(g.tag, new_group_param);

  elsif action_param = 'retire' then
    update category_tag_groups set retired_at = now(), retired_by = auth.uid(), replaced_by = v_rep_id where id = v_id;
    if v_rep_id is not null then
      select * into rep from category_tag_groups where id = v_rep_id;
      v_rows := _taxonomy_sync_group_columns(g.tag, rep.group_key)
             || _taxonomy_rewrite_references(g.tag, rep.tag, true);           -- includes FK columns and synonyms
      insert into category_synonyms (phrase, tag) values (_category_search_key(g.tag), rep.tag) on conflict do nothing;
    end if;

  elsif action_param = 'restore' then
    update category_tag_groups set retired_at = null, retired_by = null, replaced_by = null where id = v_id;
  end if;

  perform set_config('app.taxonomy_mutation', '', true);
  perform set_config('app.taxonomy_reason', '', true);
  perform set_config('app.taxonomy_request_id', '', true);
  perform set_config('app.taxonomy_impact', '', true);

  select version into v_version from category_taxonomy_version where singleton;
  return jsonb_build_object('changed', true, 'replayed', false, 'tag_id', v_id, 'taxonomy_version', v_version,
                            'rows_updated', v_rows);
end $$;
revoke all on function public._taxonomy_apply(text, text, text, text, text, boolean, text, text, uuid) from public, anon, authenticated;

create or replace function public.admin_preview_category_change(action_param text, tag_param text,
                                                                new_name_param text default null,
                                                                new_group_param text default null,
                                                                replacement_param text default null,
                                                                keep_existing_param boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id bigint; v_rep bigint;
begin
  perform _taxonomy_require_admin();
  v_id := _taxonomy_resolve_for_admin(tag_param);
  if replacement_param is not null then v_rep := _taxonomy_resolve_for_admin(replacement_param); end if;
  return _taxonomy_impact(action_param, v_id, new_name_param, new_group_param, v_rep, keep_existing_param);
end $$;

create or replace function public.admin_rename_category_tag(tag_param text, new_name_param text, reason_param text,
                                                            impact_token_param text, request_id_param uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _taxonomy_require_admin();
  return _taxonomy_apply('rename', tag_param, new_name_param, null, null, false, reason_param, impact_token_param, request_id_param);
end $$;

create or replace function public.admin_move_category_tag(tag_param text, new_group_param text, reason_param text,
                                                          impact_token_param text, request_id_param uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _taxonomy_require_admin();
  return _taxonomy_apply('move', tag_param, null, new_group_param, null, false, reason_param, impact_token_param, request_id_param);
end $$;

create or replace function public.admin_retire_category_tag(tag_param text, replacement_param text, keep_existing_param boolean,
                                                            reason_param text, impact_token_param text, request_id_param uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _taxonomy_require_admin();
  return _taxonomy_apply('retire', tag_param, null, null, replacement_param, keep_existing_param, reason_param,
                         impact_token_param, request_id_param);
end $$;

create or replace function public.admin_restore_category_tag(tag_param text, reason_param text, impact_token_param text,
                                                             request_id_param uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _taxonomy_require_admin();
  return _taxonomy_apply('restore', tag_param, null, null, null, false, reason_param, impact_token_param, request_id_param);
end $$;

create or replace function public.admin_get_category_tag_history(tag_param text)
returns table (change_id bigint, change_type text, old_name text, new_name text, old_group text, new_group text,
               replaced_by_tag text, taxonomy_version bigint, actor_id uuid, actor_kind text, reason text,
               request_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_id bigint;
begin
  perform _taxonomy_require_admin();
  -- History may be looked up by a FORMER name too.
  v_id := coalesce(_taxonomy_id_for_name(tag_param),
                   case when btrim(coalesce(tag_param, '')) ~ '^[0-9]+$' then btrim(tag_param)::bigint end);
  if v_id is null then raise exception 'Unknown category'; end if;
  return query
    select c.id, c.change_type, c.old_name, c.new_name, c.old_group, c.new_group, r.tag, c.taxonomy_version,
           c.actor_id, c.actor_kind, c.reason, c.request_id, c.created_at
    from category_taxonomy_changes c left join category_tag_groups r on r.id = c.replaced_by
    where c.tag_id = v_id order by c.id;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Public lookups (names <-> IDs), for the app and edge functions
-- ---------------------------------------------------------------------------------------------------------------------
-- A name (current or former, case-insensitive) or an ID -> the stable record and where it points now.
create or replace function public.resolve_category_tag(name_param text)
returns table (id bigint, tag text, group_key text, business_only boolean, retired boolean,
               current_tag text, current_tag_id bigint, matched_via text)
language plpgsql stable security definer set search_path = public as $$
declare v_id bigint; v_via text;
begin
  if btrim(coalesce(name_param, '')) ~ '^[0-9]+$' then
    v_id := btrim(name_param)::bigint; v_via := 'id';
  else
    select g.id into v_id from category_tag_groups g where lower(g.tag) = lower(btrim(coalesce(name_param, '')));
    v_via := 'current_name';
    if v_id is null then
      select f.tag_id into v_id from category_tag_former_names f where lower(f.name) = lower(btrim(coalesce(name_param, '')));
      v_via := 'former_name';
    end if;
  end if;
  if v_id is null then return; end if;
  return query
    select g.id, g.tag, g.group_key, g.business_only, g.retired_at is not null, t.current_tag, t.tag_id, v_via
    from category_tag_groups g cross join lateral _taxonomy_live_target(g.id) t where g.id = v_id;
end $$;

-- The whole taxonomy in one read: version, every tag (retired ones marked), and every former name.
create or replace function public.get_category_taxonomy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', (select version from category_taxonomy_version where singleton),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'tag', g.tag, 'group_key', g.group_key,
                                                          'business_only', g.business_only, 'retired', g.retired_at is not null,
                                                          'replaced_by', r.tag) order by g.id)
                      from category_tag_groups g left join category_tag_groups r on r.id = g.replaced_by), '[]'::jsonb),
    'former_names', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'tag_id', f.tag_id, 'current_tag', t.current_tag,
                                                                  'retired', t.retired) order by f.name)
                              from category_tag_former_names f cross join lateral _taxonomy_live_target(f.tag_id) t), '[]'::jsonb));
$$;

revoke all on function public._taxonomy_bump_version() from public, anon, authenticated;
revoke all on function public._taxonomy_id_for_name(text) from public, anon, authenticated;
revoke all on function public._taxonomy_live_target(bigint) from public, anon, authenticated;
revoke all on function public._taxonomy_array_replace(text[], text, text) from public, anon, authenticated;
revoke all on function public._taxonomy_reference_counts(text) from public, anon, authenticated;
revoke all on function public._taxonomy_rewrite_references(text, text, boolean) from public, anon, authenticated;
revoke all on function public._taxonomy_sync_group_columns(text, text) from public, anon, authenticated;
revoke all on function public._taxonomy_impact(text, bigint, text, text, bigint, boolean) from public, anon, authenticated;
revoke all on function public._taxonomy_resolve_for_admin(text) from public, anon, authenticated;
revoke all on function public._taxonomy_require_admin() from public, anon, authenticated;
revoke all on function public._taxonomy_record_insert() from public, anon, authenticated;
revoke all on function public._taxonomy_record_update() from public, anon, authenticated;
revoke all on function public._taxonomy_guard_row() from public, anon, authenticated;

revoke all on function public.admin_preview_category_change(text, text, text, text, text, boolean) from public, anon;
revoke all on function public.admin_rename_category_tag(text, text, text, text, uuid) from public, anon;
revoke all on function public.admin_move_category_tag(text, text, text, text, uuid) from public, anon;
revoke all on function public.admin_retire_category_tag(text, text, boolean, text, text, uuid) from public, anon;
revoke all on function public.admin_restore_category_tag(text, text, text, uuid) from public, anon;
revoke all on function public.admin_get_category_tag_history(text) from public, anon;
grant execute on function public.admin_preview_category_change(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_rename_category_tag(text, text, text, text, uuid) to authenticated;
grant execute on function public.admin_move_category_tag(text, text, text, text, uuid) to authenticated;
grant execute on function public.admin_retire_category_tag(text, text, boolean, text, text, uuid) to authenticated;
grant execute on function public.admin_restore_category_tag(text, text, text, uuid) to authenticated;
grant execute on function public.admin_get_category_tag_history(text) to authenticated;

-- The taxonomy was already anon-readable (category_tag_groups SELECT); the lookups match that.
revoke all on function public.resolve_category_tag(text) from public;
revoke all on function public.get_category_taxonomy() from public;
grant execute on function public.resolve_category_tag(text) to anon, authenticated;
grant execute on function public.get_category_taxonomy() to anon, authenticated;
