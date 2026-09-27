-- Readable, immutable category keys (2026-09-27, owner item 97; additive on top of 20270232 / 20270233).
--
-- Contract (LOCKED):
--   id   = 42        permanent numeric identity (20270232), never reused
--   key  = 'coffee'  permanent machine-readable identity: unique, lowercase, created ONCE from the name at creation,
--                    never changed afterwards (a rename keeps it), never reused (rows are never deleted, and the unique
--                    constraint covers retired rows too)
--   tag  = 'Coffee'  the current display name; renamed only through the canonical admin path
--
-- Deliberately NOT done here (deferred future migration): stored columns keep holding names, and app code keeps
-- referring to names. The eventual benefit of the key is that code can reference 'coffee' instead of the display name,
-- so a rename no longer leaves code on the old name (today tracked by the code follow-ups of 20270233).
-- Safe to rerun.

-- The one derivation: lowercase, & -> and, every run of other characters -> one underscore, trimmed.
-- 'Dessert & Ice Cream' -> dessert_and_ice_cream, 'D&D' -> d_and_d, 'Self-Care' -> self_care.
create or replace function public._category_key_from_name(name_param text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(lower(replace(coalesce(name_param, ''), '&', ' and ')), '[^a-z0-9]+', '_', 'g'), '_');
$$;
revoke all on function public._category_key_from_name(text) from public, anon, authenticated;

alter table public.category_tag_groups add column if not exists key text;

-- Backfill in id order; a (not currently occurring) collision or empty result gets the permanent id appended.
do $$
declare r record; k text;
begin
  if exists (select 1 from category_tag_groups where key is null) then
    alter table public.category_tag_groups disable trigger taxonomy_guard_row;
    alter table public.category_tag_groups disable trigger taxonomy_record_update;
    for r in select id, tag from category_tag_groups where key is null order by id loop
      k := _category_key_from_name(r.tag);
      if k = '' or exists (select 1 from category_tag_groups where key = k) then
        k := concat_ws('_', nullif(k, ''), 'category', r.id);
      end if;
      update category_tag_groups set key = k where id = r.id;
    end loop;
    alter table public.category_tag_groups enable trigger taxonomy_record_update;
    alter table public.category_tag_groups enable trigger taxonomy_guard_row;
  end if;
end $$;

alter table public.category_tag_groups alter column key set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'category_tag_groups_key_key') then
    alter table public.category_tag_groups add constraint category_tag_groups_key_key unique (key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'category_tag_groups_key_format') then
    alter table public.category_tag_groups add constraint category_tag_groups_key_format
      check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(key) <= 80);
  end if;
end $$;

-- Assigned on insert (after taxonomy_guard_row has taken the id from the sequence: triggers fire in name order),
-- frozen on update. A key that was ever used, by a live or retired category, is taken forever.
create or replace function public._taxonomy_key_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if TG_OP = 'INSERT' then
    k := coalesce(nullif(btrim(NEW.key), ''), _category_key_from_name(NEW.tag));
    if k = '' or exists (select 1 from category_tag_groups where key = k) then
      if NEW.key is not null then raise exception 'The category key % is already taken.', NEW.key; end if;
      k := concat_ws('_', nullif(k, ''), 'category', NEW.id);
    end if;
    NEW.key := k;
    return NEW;
  end if;
  if NEW.key is distinct from OLD.key then
    raise exception 'A category key never changes (% stays %).', OLD.tag, OLD.key;
  end if;
  return NEW;
end $$;
revoke all on function public._taxonomy_key_row() from public, anon, authenticated;

drop trigger if exists taxonomy_key_row on public.category_tag_groups;
create trigger taxonomy_key_row before insert or update on public.category_tag_groups
  for each row execute function public._taxonomy_key_row();

-- The public snapshot carries the key beside the id (additive field; nothing reads it yet).
create or replace function public.get_category_taxonomy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', (select version from category_taxonomy_version where singleton),
    'pending_code_updates', (select count(*) from category_code_followups where status = 'open'),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'key', g.key, 'tag', g.tag, 'group_key', g.group_key,
                                                          'business_only', g.business_only, 'retired', g.retired_at is not null,
                                                          'replaced_by', r.tag) order by g.id)
                      from category_tag_groups g left join category_tag_groups r on r.id = g.replaced_by), '[]'::jsonb),
    'former_names', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'tag_id', f.tag_id, 'current_tag', t.current_tag,
                                                                  'retired', t.retired) order by f.name)
                              from category_tag_former_names f cross join lateral _taxonomy_live_target(f.tag_id) t), '[]'::jsonb));
$$;
