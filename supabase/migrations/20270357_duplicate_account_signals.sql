-- Trust & safety I1 (owner direction approved with refinements, 2026-10-29): duplicate / fake account SIGNALS for admin
-- review. Staged after 20270356; deploy only with its own approval (and the Privacy Policy sentence, owner decision e).
-- Flag -> investigate -> action: nothing here bans, hides, restricts or limits anyone, and neither person ever sees a
-- signal or a case (private schema; only admins read it, through the two functions at the end).
--
-- Fingerprint = the MD5 Storage itself computed for the uploaded file (storage.objects.metadata eTag, single-part
-- uploads; a multipart eTag "<hash>-<n>" is not a file hash and is skipped). Nothing is computed from or sent off the
-- device, no device data, no AI, no third party. It matches only byte-identical files: a resized, cropped or re-encoded
-- copy is NOT caught (similar-image detection = later, subject to a privacy review).
-- A case opens ONLY when an approved rule holds (private.account_signal_settings starts all null = no cases at all):
--   many_accounts   the same file on at least duplicate_photo_min_accounts distinct accounts
--   similar_names   the same file on two or more accounts AND two of those accounts have similar display names
--                   (pg_trgm similarity >= similar_name_min_similarity); a similar name alone never does anything
-- An identical photo on just two accounts with unrelated names opens nothing (stock images, couples, shared photos).
-- One open case per fingerprint; later accounts join it. The admin closes it with an outcome + note; any action against
-- an account is the existing admin suspension (20270351), recorded there.

create table if not exists private.photo_fingerprints (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,                       -- 'main' or the extra photo's id
  object_id uuid,
  md5 text not null check (md5 ~ '^[0-9a-f]{32}$'),
  recorded_at timestamptz not null default now(),
  primary key (user_id, slot)
);
create index if not exists photo_fingerprints_md5_idx on private.photo_fingerprints (md5);

create table if not exists private.account_signal_settings (
  id boolean primary key default true check (id),
  duplicate_photo_min_accounts integer check (duplicate_photo_min_accounts is null or duplicate_photo_min_accounts >= 2),
  similar_name_min_similarity real check (similar_name_min_similarity is null or similar_name_min_similarity between 0.3 and 1),
  updated_at timestamptz not null default now()
);
insert into private.account_signal_settings (id) values (true) on conflict (id) do nothing;

create table if not exists private.account_review_cases (
  id uuid primary key default gen_random_uuid(),
  signal text not null check (signal in ('identical_photo')),
  md5 text not null,
  reason text not null check (reason in ('many_accounts', 'similar_names')),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  outcome text check (outcome in ('no_action', 'action_taken')),
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  check ((status = 'closed') = (closed_at is not null and outcome is not null))
);
create unique index if not exists account_review_cases_one_open on private.account_review_cases (md5) where status = 'open';

create table if not exists private.account_review_case_members (
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (case_id, user_id)
);
revoke all on private.photo_fingerprints, private.account_signal_settings, private.account_review_cases,
  private.account_review_case_members from public, anon, authenticated;

create or replace function private.normalized_name(p text)
returns text
language sql
immutable
as $function$
  select nullif(btrim(regexp_replace(lower(coalesce(p, '')), '[^[:alpha:][:space:]]', '', 'g')), '');
$function$;
revoke all on function private.normalized_name(text) from public, anon, authenticated;

-- Opens / extends the case for one fingerprint when an approved rule holds. Never touches the accounts themselves.
create or replace function private.evaluate_photo_fingerprint(p_md5 text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.account_signal_settings;
  v_users uuid[];
  v_reason text;
  v_case uuid;
begin
  select * into s from private.account_signal_settings where id;
  if s.duplicate_photo_min_accounts is null and s.similar_name_min_similarity is null then return; end if;
  select array_agg(distinct user_id) into v_users from private.photo_fingerprints where md5 = p_md5;
  if coalesce(cardinality(v_users), 0) < 2 then return; end if;

  if s.duplicate_photo_min_accounts is not null and cardinality(v_users) >= s.duplicate_photo_min_accounts then
    v_reason := 'many_accounts';
  elsif s.similar_name_min_similarity is not null and exists (
      select 1 from profiles a join profiles b on a.id < b.id
       where a.id = any(v_users) and b.id = any(v_users)
         and private.normalized_name(a.display_name) is not null
         and private.normalized_name(b.display_name) is not null
         and similarity(private.normalized_name(a.display_name), private.normalized_name(b.display_name))
             >= s.similar_name_min_similarity) then
    v_reason := 'similar_names';
  end if;
  if v_reason is null then return; end if;

  select id into v_case from private.account_review_cases where md5 = p_md5 and status = 'open' for update;
  if v_case is null then
    insert into private.account_review_cases (signal, md5, reason) values ('identical_photo', p_md5, v_reason)
      on conflict (md5) where status = 'open' do nothing
      returning id into v_case;
    if v_case is null then
      select id into v_case from private.account_review_cases where md5 = p_md5 and status = 'open';
    end if;
  else
    update private.account_review_cases
       set updated_at = now(),
           reason = case when v_reason = 'many_accounts' then 'many_accounts' else reason end
     where id = v_case;
  end if;
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;
end;
$function$;
revoke all on function private.evaluate_photo_fingerprint(text) from public, anon, authenticated;

-- Records (or forgets) the fingerprint of one photo slot from the file it points at, then evaluates it.
create or replace function private.record_photo_fingerprint(p_user uuid, p_slot text, p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_object uuid;
  v_etag text;
begin
  if p_path is null then
    delete from private.photo_fingerprints where user_id = p_user and slot = p_slot;
    return;
  end if;
  select o.id, lower(btrim(o.metadata->>'eTag', '"')) into v_object, v_etag
    from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_path;
  if v_etag is null or v_etag !~ '^[0-9a-f]{32}$' then
    delete from private.photo_fingerprints where user_id = p_user and slot = p_slot;
    return;
  end if;
  insert into private.photo_fingerprints (user_id, slot, object_id, md5) values (p_user, p_slot, v_object, v_etag)
    on conflict (user_id, slot) do update set object_id = excluded.object_id, md5 = excluded.md5, recorded_at = now();
  perform private.evaluate_photo_fingerprint(v_etag);
end;
$function$;
revoke all on function private.record_photo_fingerprint(uuid, text, text) from public, anon, authenticated;

create or replace function public._fingerprint_main_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' or new.photo_url is distinct from old.photo_url then
    perform private.record_photo_fingerprint(new.id, 'main', new.photo_url);
  elsif new.display_name is distinct from old.display_name then
    -- a name change can make an existing identical photo corroborated
    perform private.evaluate_photo_fingerprint(f.md5) from private.photo_fingerprints f where f.user_id = new.id;
  end if;
  return null;
end;
$function$;
revoke all on function public._fingerprint_main_photo() from public, anon, authenticated;
drop trigger if exists fingerprint_main_photo on public.profiles;
create trigger fingerprint_main_photo after insert or update of photo_url, display_name on public.profiles
  for each row execute function public._fingerprint_main_photo();

create or replace function public._fingerprint_extra_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    delete from private.photo_fingerprints where user_id = old.user_id and slot = old.id::text;
    return null;
  end if;
  if tg_op = 'INSERT' or new.photo_url is distinct from old.photo_url then
    perform private.record_photo_fingerprint(new.user_id, new.id::text, new.photo_url);
  end if;
  return null;
end;
$function$;
revoke all on function public._fingerprint_extra_photo() from public, anon, authenticated;
drop trigger if exists fingerprint_extra_photo on public.profile_photos;
create trigger fingerprint_extra_photo after insert or update of photo_url or delete on public.profile_photos
  for each row execute function public._fingerprint_extra_photo();

-- Existing photos get their fingerprint now (no case can open: the settings start null).
insert into private.photo_fingerprints (user_id, slot, object_id, md5)
select p.id, 'main', o.id, lower(btrim(o.metadata->>'eTag', '"'))
  from public.profiles p join storage.objects o on o.bucket_id = 'profile-photos' and o.name = p.photo_url
 where lower(btrim(o.metadata->>'eTag', '"')) ~ '^[0-9a-f]{32}$'
on conflict (user_id, slot) do nothing;
insert into private.photo_fingerprints (user_id, slot, object_id, md5)
select pp.user_id, pp.id::text, o.id, lower(btrim(o.metadata->>'eTag', '"'))
  from public.profile_photos pp join storage.objects o on o.bucket_id = 'profile-photos' and o.name = pp.photo_url
 where lower(btrim(o.metadata->>'eTag', '"')) ~ '^[0-9a-f]{32}$'
on conflict (user_id, slot) do nothing;

-- Admin review: list cases (open first) with each member's name and whether they are suspended; never the fingerprint.
create or replace function public.admin_list_account_review_cases(include_closed_param boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'signal', c.signal, 'reason', c.reason, 'status', c.status,
             'opened_at', c.opened_at, 'updated_at', c.updated_at, 'closed_at', c.closed_at,
             'outcome', c.outcome, 'note', c.note,
             'members', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'user_id', m.user_id, 'display_name', p.display_name,
                                  'suspended', p.suspended_at is not null, 'added_at', m.added_at) order by m.added_at), '[]'::jsonb)
                           from private.account_review_case_members m left join profiles p on p.id = m.user_id
                          where m.case_id = c.id))
           order by (c.status = 'open') desc, c.updated_at desc)
      from private.account_review_cases c
     where include_closed_param or c.status = 'open'), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_list_account_review_cases(boolean) from public, anon;
grant execute on function public.admin_list_account_review_cases(boolean) to authenticated;

create or replace function public.admin_close_account_review_case(case_id_param uuid, outcome_param text, note_param text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_status text;
  v_note text := nullif(btrim(coalesce(note_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if outcome_param not in ('no_action', 'action_taken') then
    raise exception 'Choose an outcome' using errcode = '22023', hint = 'case_outcome';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters' using errcode = '22023', hint = 'case_note_length';
  end if;
  select status into v_status from private.account_review_cases where id = case_id_param for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('already', true);
  end if;
  update private.account_review_cases
     set status = 'closed', closed_at = now(), closed_by = v_admin, outcome = outcome_param, note = v_note, updated_at = now()
   where id = case_id_param;
  return jsonb_build_object('already', false);
end;
$function$;
revoke all on function public.admin_close_account_review_case(uuid, text, text) from public, anon;
grant execute on function public.admin_close_account_review_case(uuid, text, text) to authenticated;
