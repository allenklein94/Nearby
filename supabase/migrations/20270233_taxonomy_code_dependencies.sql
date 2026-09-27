-- Taxonomy code dependencies (2026-09-27, follows 20270232). The server cannot see category names written into app code
-- (quick picks, synonyms, energy / commitment / duration maps, the baseline list, the static signup export...), so a
-- rename could commit "successfully" while the app still behaves on the old name. This closes that gap:
--
--   category_code_dependencies   the inventory of every (category name, file) reference in shipped code, generated from
--                                the repo (scripts/taxonomy/build-code-dependencies.js, kept fresh by a Jest test) and
--                                synced here (scripts/taxonomy/sync-code-dependencies.js -> sync_category_code_dependencies)
--   category_code_followups      what a committed change left for code to do; the change is INCOMPLETE while any is open
--
-- The preview (admin_preview_category_change) now lists the code a change would leave stale, and refuses to run at all
-- when the inventory was never synced (fail closed: no rename without knowing its code consumers). Committing records one
-- follow-up per stale reference and returns complete = false; a later sync of the updated code resolves them
-- automatically; an admin can waive one only with a written reason. The data side (20270232) is unchanged.
-- Safe to rerun.

create table if not exists public.category_code_dependencies (
  tag_name text not null,
  source_file text not null,
  consumer text not null,
  occurrences integer not null check (occurrences > 0),
  placement_group text,          -- only for files that PLACE a tag in a group (baseline list, static signup export)
  primary key (tag_name, source_file)
);

create table if not exists public.category_code_inventory_state (
  singleton boolean primary key default true check (singleton),
  source_commit text not null,
  row_count integer not null,
  synced_at timestamptz not null default now()
);

create table if not exists public.category_code_followups (
  id bigserial primary key,
  change_id bigint not null references public.category_taxonomy_changes (id),
  tag_id bigint not null references public.category_tag_groups (id),
  kind text not null check (kind in ('replace_name', 'move_group', 'stop_offering')),
  name text not null,              -- the name the code must stop using (replace/stop) or the tag to move
  replacement text,                -- replace_name: the name to use instead
  expected_group text,             -- move_group: where the file must place the tag
  consumer text not null,
  source_file text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'waived')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_commit text,
  waived_by uuid,
  waive_reason text
);
create index if not exists category_code_followups_open_idx on public.category_code_followups (status, tag_id);

alter table public.category_code_dependencies enable row level security;
alter table public.category_code_inventory_state enable row level security;
alter table public.category_code_followups enable row level security;
revoke all on public.category_code_dependencies, public.category_code_inventory_state, public.category_code_followups
  from public, anon, authenticated;
revoke all on sequence public.category_code_followups_id_seq from public, anon, authenticated;

-- A follow-up is never deleted; only its status moves forward (open -> resolved | waived).
create or replace function public._taxonomy_followup_guard()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then raise exception 'category_code_followups is append-only.'; end if;
  if OLD.status <> 'open' then raise exception 'A closed follow-up cannot change.'; end if;
  if (NEW.change_id, NEW.tag_id, NEW.kind, NEW.name, NEW.consumer, NEW.source_file)
       is distinct from (OLD.change_id, OLD.tag_id, OLD.kind, OLD.name, OLD.consumer, OLD.source_file) then
    raise exception 'Only a follow-up''s status can change.';
  end if;
  return NEW;
end $$;
drop trigger if exists followup_guard on public.category_code_followups;
create trigger followup_guard before update or delete on public.category_code_followups
  for each row execute function public._taxonomy_followup_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- What code a change would leave stale
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._taxonomy_code_impact(action_param text, tag_id_param bigint, new_name_param text,
                                                        new_group_param text, replacement_id_param bigint,
                                                        keep_existing_param boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g record;
  v_state record;
  v_deps jsonb := '[]'::jsonb;
  v_rep text;
begin
  select * into g from category_tag_groups where id = tag_id_param;
  select * into v_state from category_code_inventory_state where singleton;
  if g.id is null then return jsonb_build_object('dependencies', '[]'::jsonb); end if;

  if action_param = 'rename' then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'replace_name', 'name', d.tag_name,
             'replacement', regexp_replace(btrim(coalesce(new_name_param, '')), '\s+', ' ', 'g'),
             'consumer', d.consumer, 'file', d.source_file, 'occurrences', d.occurrences) order by d.consumer, d.source_file), '[]'::jsonb)
      into v_deps from category_code_dependencies d where d.tag_name = g.tag;
  elsif action_param = 'move' then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'move_group', 'name', d.tag_name, 'expected_group', new_group_param,
             'placed_in', d.placement_group, 'consumer', d.consumer, 'file', d.source_file, 'occurrences', d.occurrences)
             order by d.consumer, d.source_file), '[]'::jsonb)
      into v_deps from category_code_dependencies d
     where d.tag_name = g.tag and d.placement_group is not null and d.placement_group is distinct from new_group_param;
  elsif action_param = 'retire' and replacement_id_param is not null then
    select tag into v_rep from category_tag_groups where id = replacement_id_param;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'replace_name', 'name', d.tag_name, 'replacement', v_rep,
             'consumer', d.consumer, 'file', d.source_file, 'occurrences', d.occurrences) order by d.consumer, d.source_file), '[]'::jsonb)
      into v_deps from category_code_dependencies d where d.tag_name = g.tag;
  elsif action_param = 'retire' then
    -- Kept on the retired name: maps that interpret stored rows stay valid; only places that OFFER it must stop.
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'stop_offering', 'name', d.tag_name,
             'consumer', d.consumer, 'file', d.source_file, 'occurrences', d.occurrences) order by d.consumer, d.source_file), '[]'::jsonb)
      into v_deps from category_code_dependencies d
     where d.tag_name = g.tag and d.consumer in ('baseline_taxonomy', 'quick_picks', 'synonyms', 'static_signup_export');
  end if;

  return jsonb_build_object(
    'inventory', case when v_state.singleton is null then null
                      else jsonb_build_object('source_commit', v_state.source_commit, 'rows', v_state.row_count,
                                              'synced_at', v_state.synced_at) end,
    'dependencies', v_deps,
    'other_references', case when action_param = 'retire' and replacement_id_param is null then
      (select count(*) from category_code_dependencies d where d.tag_name = g.tag
         and d.consumer not in ('baseline_taxonomy', 'quick_picks', 'synonyms', 'static_signup_export')) end);
end $$;

-- The data-side impact from 20270232 keeps its body under a new name; _taxonomy_impact now adds the code side and
-- binds BOTH into the token (a change to the code inventory after a preview also invalidates it).
do $$ begin
  if exists (select 1 from pg_proc where proname = '_taxonomy_impact' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = '_taxonomy_data_impact' and pronamespace = 'public'::regnamespace) then
    alter function public._taxonomy_impact(text, bigint, text, text, bigint, boolean) rename to _taxonomy_data_impact;
  end if;
end $$;
revoke all on function public._taxonomy_data_impact(text, bigint, text, text, bigint, boolean) from public, anon, authenticated;

create or replace function public._taxonomy_impact(action_param text, tag_id_param bigint, new_name_param text,
                                                   new_group_param text, replacement_id_param bigint,
                                                   keep_existing_param boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := _taxonomy_data_impact(action_param, tag_id_param, new_name_param, new_group_param, replacement_id_param, keep_existing_param);
  c jsonb;
  v_blockers jsonb;
  v_warnings jsonb;
  n int;
begin
  if coalesce((v->>'noop')::boolean, false) or v->'tag' is null then return v; end if;
  c := _taxonomy_code_impact(action_param, tag_id_param, new_name_param, new_group_param, replacement_id_param, keep_existing_param);
  v_blockers := coalesce(v->'blockers', '[]'::jsonb);
  v_warnings := coalesce(v->'warnings', '[]'::jsonb);
  n := jsonb_array_length(c->'dependencies');
  if action_param in ('rename', 'move', 'retire') and jsonb_typeof(c->'inventory') is distinct from 'object' then
    v_blockers := v_blockers || to_jsonb(text 'The app code inventory has never been synced, so the code this change affects is unknown. Run scripts/taxonomy/sync-code-dependencies.js first.');
  elsif n > 0 then
    v_warnings := v_warnings || to_jsonb(format(
      '%s app code reference(s) still use %s (%s). The change will be recorded as INCOMPLETE until that code is updated and the inventory re-synced.',
      n, v->'tag'->>'name',
      (select string_agg(distinct d->>'consumer', ', ') from jsonb_array_elements(c->'dependencies') d)));
  end if;
  if coalesce((c->>'other_references')::int, 0) > 0 then
    v_warnings := v_warnings || to_jsonb(format('%s other code file(s) mention it; they keep working for rows that still carry it.',
                                                c->>'other_references'));
  end if;
  return v || jsonb_build_object(
    'blockers', v_blockers,
    'warnings', v_warnings,
    'code', c,
    'complete_after_commit', n = 0,
    'impact_token', md5(coalesce(v->>'impact_token', '') || '|' || (c->'dependencies')::text || '|' || coalesce((c->'inventory')::text, '')));
end $$;
revoke all on function public._taxonomy_code_impact(text, bigint, text, text, bigint, boolean) from public, anon, authenticated;
revoke all on function public._taxonomy_impact(text, bigint, text, text, bigint, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Commit records the follow-ups; the result says whether the change is complete
-- ---------------------------------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_taxonomy_apply_core' and pronamespace = 'public'::regnamespace) then
    alter function public._taxonomy_apply(text, text, text, text, text, boolean, text, text, uuid) rename to _taxonomy_apply_core;
  end if;
end $$;
revoke all on function public._taxonomy_apply_core(text, text, text, text, text, boolean, text, text, uuid) from public, anon, authenticated;

create or replace function public._taxonomy_change_status(change_id_param bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'complete', count(*) filter (where status = 'open') = 0,
    'open_code_followups', count(*) filter (where status = 'open'),
    'code_followups', coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'replacement', replacement,
                        'expected_group', expected_group, 'consumer', consumer, 'file', source_file, 'status', status)
                        order by id) filter (where id is not null), '[]'::jsonb))
  from category_code_followups where change_id = change_id_param;
$$;
revoke all on function public._taxonomy_change_status(bigint) from public, anon, authenticated;

create or replace function public._taxonomy_apply(action_param text, tag_param text, new_name_param text,
                                                  new_group_param text, replacement_param text, keep_existing_param boolean,
                                                  reason_param text, impact_token_param text, request_id_param uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expected text := case action_param when 'rename' then 'renamed' when 'move' then 'moved'
                                       when 'retire' then 'retired' when 'restore' then 'restored' end;
  r jsonb;
  ch record;
begin
  r := _taxonomy_apply_core(action_param, tag_param, new_name_param, new_group_param, replacement_param, keep_existing_param,
                            reason_param, impact_token_param, request_id_param);
  if not coalesce((r->>'changed')::boolean, false) then return r || jsonb_build_object('complete', true); end if;
  select id, impact into ch from category_taxonomy_changes
   where request_id = request_id_param and change_type = v_expected order by id limit 1;
  if ch.id is null then return r; end if;
  if not coalesce((r->>'replayed')::boolean, false) then
    insert into category_code_followups (change_id, tag_id, kind, name, replacement, expected_group, consumer, source_file)
    select ch.id, (r->>'tag_id')::bigint, d->>'kind', d->>'name', d->>'replacement', d->>'expected_group', d->>'consumer', d->>'file'
    from jsonb_array_elements(coalesce(ch.impact->'code'->'dependencies', '[]'::jsonb)) d;
  end if;
  return r || jsonb_build_object('change_id', ch.id) || _taxonomy_change_status(ch.id);
end $$;
revoke all on function public._taxonomy_apply(text, text, text, text, text, boolean, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Sync the inventory (repo -> database) and resolve what the updated code no longer depends on
-- ---------------------------------------------------------------------------------------------------------------------
-- Called only by the sync script as the database owner (no client grants). inventory = code-dependencies.json.
create or replace function public.sync_category_code_dependencies(inventory_param jsonb, source_commit_param text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows int; v_resolved int;
begin
  if coalesce((inventory_param->>'format')::int, 0) <> 1 or jsonb_typeof(inventory_param->'rows') <> 'array' then
    raise exception 'Unknown inventory format';
  end if;
  if btrim(coalesce(source_commit_param, '')) = '' then raise exception 'A source commit is required'; end if;
  delete from category_code_dependencies;
  insert into category_code_dependencies (tag_name, source_file, consumer, occurrences, placement_group)
  select d->>'tag', d->>'file', d->>'consumer', (d->>'occurrences')::int, d->>'group'
  from jsonb_array_elements(inventory_param->'rows') d;
  get diagnostics v_rows = row_count;
  insert into category_code_inventory_state (singleton, source_commit, row_count, synced_at)
  values (true, source_commit_param, v_rows, now())
  on conflict (singleton) do update set source_commit = excluded.source_commit, row_count = excluded.row_count, synced_at = now();

  update category_code_followups f set status = 'resolved', resolved_at = now(), resolved_by_commit = source_commit_param
  where f.status = 'open' and (
    (f.kind in ('replace_name', 'stop_offering')
       and not exists (select 1 from category_code_dependencies d where d.tag_name = f.name and d.source_file = f.source_file))
    or (f.kind = 'move_group'
       and not exists (select 1 from category_code_dependencies d join category_tag_groups g on g.id = f.tag_id
                        where d.tag_name = g.tag and d.source_file = f.source_file
                          and d.placement_group is distinct from f.expected_group))
  );
  get diagnostics v_resolved = row_count;
  return jsonb_build_object('rows', v_rows, 'resolved', v_resolved,
                            'still_open', (select count(*) from category_code_followups where status = 'open'));
end $$;
revoke all on function public.sync_category_code_dependencies(jsonb, text) from public, anon, authenticated;

create or replace function public.admin_get_taxonomy_followups(include_closed_param boolean default false)
returns table (followup_id bigint, change_id bigint, change_type text, tag_id bigint, current_tag text, kind text,
               name text, replacement text, expected_group text, consumer text, source_file text, status text,
               created_at timestamptz, resolved_at timestamptz, resolved_by_commit text, waive_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _taxonomy_require_admin();
  return query
    select f.id, f.change_id, c.change_type, f.tag_id, g.tag, f.kind, f.name, f.replacement, f.expected_group, f.consumer,
           f.source_file, f.status, f.created_at, f.resolved_at, f.resolved_by_commit, f.waive_reason
    from category_code_followups f
    join category_taxonomy_changes c on c.id = f.change_id
    join category_tag_groups g on g.id = f.tag_id
    where include_closed_param or f.status = 'open'
    order by f.id;
end $$;

-- A false positive (e.g. a UI word that happens to equal a category name) may be waived, never silently: named admin,
-- written reason, and the row stays.
create or replace function public.admin_waive_taxonomy_followup(followup_id_param bigint, reason_param text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_change bigint;
begin
  perform _taxonomy_require_admin();
  if char_length(btrim(coalesce(reason_param, ''))) < 10 then
    raise exception 'Say why this code reference does not need updating (at least 10 characters).';
  end if;
  update category_code_followups set status = 'waived', resolved_at = now(), waived_by = auth.uid(), waive_reason = btrim(reason_param)
   where id = followup_id_param and status = 'open' returning change_id into v_change;
  if v_change is null then raise exception 'No open follow-up with that id.'; end if;
  return _taxonomy_change_status(v_change);
end $$;

revoke all on function public.admin_get_taxonomy_followups(boolean) from public, anon;
revoke all on function public.admin_waive_taxonomy_followup(bigint, text) from public, anon;
grant execute on function public.admin_get_taxonomy_followups(boolean) to authenticated;
grant execute on function public.admin_waive_taxonomy_followup(bigint, text) to authenticated;

-- The public snapshot says whether any committed change is still waiting on app code (a count only).
create or replace function public.get_category_taxonomy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', (select version from category_taxonomy_version where singleton),
    'pending_code_updates', (select count(*) from category_code_followups where status = 'open'),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'tag', g.tag, 'group_key', g.group_key,
                                                          'business_only', g.business_only, 'retired', g.retired_at is not null,
                                                          'replaced_by', r.tag) order by g.id)
                      from category_tag_groups g left join category_tag_groups r on r.id = g.replaced_by), '[]'::jsonb),
    'former_names', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'tag_id', f.tag_id, 'current_tag', t.current_tag,
                                                                  'retired', t.retired) order by f.name)
                              from category_tag_former_names f cross join lateral _taxonomy_live_target(f.tag_id) t), '[]'::jsonb));
$$;
