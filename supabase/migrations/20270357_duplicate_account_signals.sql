-- Trust & safety I1 (owner direction approved with refinements, 2026-10-29): duplicate / fake account SIGNALS for admin
-- review. Staged after 20270356; deploy only with its own approval (and the Privacy Policy sentence, owner decision e).
-- Flag -> investigate -> action: nothing here bans, hides, restricts or limits anyone, and neither person ever sees a
-- signal or a case (private schema; only admins read it, through the two functions at the end).
--
-- Fingerprint = SHA-256 of the exact file bytes (owner decision 2026-10-29: SHA-256, not Storage's MD5 eTag). It is
-- computed by the `moderate-photo` edge function from the bytes it already downloads to screen the photo, and recorded
-- through record_photo_fingerprint (service role only) for that exact storage object. No device data, no AI, nothing
-- sent to a third party. It matches only byte-identical files: a resized, cropped or re-encoded copy is NOT caught
-- (similar-image detection = later, subject to a privacy review). Photos uploaded before deploy are fingerprinted by
-- scripts/trust-safety/fingerprint-existing-photos.js (or when next screened).
-- Only photos an account is USING count (its main photo or an extra photo); a replaced or deleted photo's fingerprint is
-- forgotten.
-- A case opens ONLY when an approved rule holds (private.account_signal_settings starts all null = no cases; numbers in
-- 20270358):
--   many_accounts   the same file in use on at least duplicate_photo_min_accounts distinct accounts
--   similar_names   the same file on two or more accounts AND two of those accounts have similar display names
--                   (pg_trgm similarity >= similar_name_min_similarity); a similar name alone never does anything
-- An identical photo on just two accounts with unrelated names opens nothing (stock images, couples, shared photos).
-- One open case per fingerprint; later accounts join it. The admin closes it with an outcome + note; any action against
-- an account is the existing admin suspension (20270351), recorded there.

create table if not exists private.photo_fingerprints (
  object_id uuid primary key,               -- storage.objects.id of the screened file version
  user_id uuid not null references auth.users(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now()
);
create index if not exists photo_fingerprints_sha256_idx on private.photo_fingerprints (sha256);
create index if not exists photo_fingerprints_user_idx on private.photo_fingerprints (user_id);

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
  sha256 text not null,
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
create unique index if not exists account_review_cases_one_open on private.account_review_cases (sha256) where status = 'open';

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

-- Is this storage object the account's main photo or one of its extra photos right now?
create or replace function private.photo_object_in_use(p_user uuid, p_object uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from storage.objects o
     where o.id = p_object and o.bucket_id = 'profile-photos'
       and (o.name = (select p.photo_url from profiles p where p.id = p_user)
            or exists (select 1 from profile_photos pp where pp.user_id = p_user and pp.photo_url = o.name)));
$function$;
revoke all on function private.photo_object_in_use(uuid, uuid) from public, anon, authenticated;

-- Forget the fingerprints of files the account no longer uses.
create or replace function private.forget_unused_photo_fingerprints(p_user uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.photo_fingerprints f
   where f.user_id = p_user and not private.photo_object_in_use(p_user, f.object_id);
$function$;
revoke all on function private.forget_unused_photo_fingerprints(uuid) from public, anon, authenticated;

-- Opens / extends the case for one fingerprint when an approved rule holds. Never touches the accounts themselves.
create or replace function private.evaluate_photo_fingerprint(p_sha256 text)
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
  select array_agg(distinct f.user_id) into v_users from private.photo_fingerprints f
   where f.sha256 = p_sha256 and private.photo_object_in_use(f.user_id, f.object_id);
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

  select id into v_case from private.account_review_cases where sha256 = p_sha256 and status = 'open' for update;
  if v_case is null then
    insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', p_sha256, v_reason)
      on conflict (sha256) where status = 'open' do nothing
      returning id into v_case;
    if v_case is null then
      select id into v_case from private.account_review_cases where sha256 = p_sha256 and status = 'open';
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

-- Called by moderate-photo (service role) with the SHA-256 of the bytes it downloaded for that exact object. Records it
-- only while the object is that account's photo; returns whether it was recorded.
create or replace function public.record_photo_fingerprint(p_user uuid, p_object_id uuid, p_sha256 text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sha text := lower(btrim(coalesce(p_sha256, '')));
begin
  if p_user is null or p_object_id is null or v_sha !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  perform private.forget_unused_photo_fingerprints(p_user);
  if not private.photo_object_in_use(p_user, p_object_id) then
    return false;
  end if;
  insert into private.photo_fingerprints (object_id, user_id, sha256) values (p_object_id, p_user, v_sha)
    on conflict (object_id) do update set sha256 = excluded.sha256, user_id = excluded.user_id, recorded_at = now();
  perform private.evaluate_photo_fingerprint(v_sha);
  return true;
end;
$function$;
revoke all on function public.record_photo_fingerprint(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_photo_fingerprint(uuid, uuid, text) to service_role;

create or replace function public._fingerprint_main_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.photo_url is distinct from old.photo_url then
    perform private.forget_unused_photo_fingerprints(new.id);
  elsif new.display_name is distinct from old.display_name then
    -- a name change can make an existing identical photo corroborated
    perform private.evaluate_photo_fingerprint(f.sha256) from private.photo_fingerprints f where f.user_id = new.id;
  end if;
  return null;
end;
$function$;
revoke all on function public._fingerprint_main_photo() from public, anon, authenticated;
drop trigger if exists fingerprint_main_photo on public.profiles;
create trigger fingerprint_main_photo after update of photo_url, display_name on public.profiles
  for each row execute function public._fingerprint_main_photo();

create or replace function public._fingerprint_extra_photo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform private.forget_unused_photo_fingerprints(old.user_id);
  return null;
end;
$function$;
revoke all on function public._fingerprint_extra_photo() from public, anon, authenticated;
drop trigger if exists fingerprint_extra_photo on public.profile_photos;
create trigger fingerprint_extra_photo after update of photo_url or delete on public.profile_photos
  for each row execute function public._fingerprint_extra_photo();

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
