-- Near-duplicate photos for admin review (owner approved 2026-10-30, with safeguards). Staged after 20270367; deploy only
-- with its own approval, together with the moderate-photo change in the same commit. DETECTS NOTHING until the owner
-- approves distances: similar_photo_max_dhash / similar_photo_max_phash start null, so no comparison runs and no case
-- opens (calibration numbers + measured false/missed matches: PRODUCT_AUDIT/PHOTO_SIMILARITY_CALIBRATION_2026-10-30.md).
--
-- What it adds to 20270357 (exact copies only):
--   * moderate-photo computes two 64-bit perceptual hashes (dHash, pHash) of six variants of the photo it already
--     downloads for screening (whole, mirrored, centre 90% and 80%, each also mirrored; supabase/functions/_shared/perceptualHash.js)
--     and records them through record_photo_perceptual_hashes (service role only) for that exact storage object.
--     No AI, no face or identity analysis, no device data, nothing sent to a third party.
--   * Two photos of DIFFERENT accounts are "similar" when, for one allowed pairing (one photo's whole image against any
--     variant of the other), BOTH hash distances are within the approved limits. Only photos an account is USING count;
--     a replaced or deleted photo's hashes are forgotten with its fingerprint.
--   * A case (signal 'similar_photo') opens only under the SAME approved rules as exact copies: the photo on at least
--     duplicate_photo_min_accounts accounts, or on two or more accounts with similar names. Similar photos on two accounts
--     with unrelated names open nothing. A photo already in a case (open or closed) never opens a second one; later
--     accounts join the open case (a closed case: 20270369 decides). Each case keeps the photos it is about
--     (private.account_review_case_photos) so a reviewer can compare them (20270369).
-- NOTHING here bans, suspends, hides, restricts or limits anyone, or tells anyone. A similar photo is a reason for a human
-- to look, never proof: stock images, couples and friends' group photos are expected matches.
-- Scale: matching scans the in-use hashes (a few per account), fine for the current size; an index structure is needed
-- before many thousands of accounts.

create table if not exists private.photo_perceptual_hashes (
  object_id uuid not null,                  -- storage.objects.id of the screened file version
  user_id uuid not null references auth.users(id) on delete cascade,
  variant text not null check (variant in ('full', 'mirror', 'crop90', 'crop90_mirror', 'crop80', 'crop80_mirror')),
  dhash bigint not null,
  phash bigint not null,
  hash_version smallint not null default 1 check (hash_version = 1),
  recorded_at timestamptz not null default now(),
  primary key (object_id, variant)
);
create index if not exists photo_perceptual_hashes_user_idx on private.photo_perceptual_hashes (user_id);

alter table private.account_signal_settings
  add column if not exists similar_photo_max_dhash smallint
    check (similar_photo_max_dhash is null or similar_photo_max_dhash between 0 and 20),
  add column if not exists similar_photo_max_phash smallint
    check (similar_photo_max_phash is null or similar_photo_max_phash between 0 and 20);

-- The photos each case is about (photo cases), kept with the case for side-by-side review and deleted with it.
create table if not exists private.account_review_case_photos (
  case_id uuid not null references private.account_review_cases(id) on delete cascade,
  object_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (case_id, object_id)
);
create index if not exists account_review_case_photos_object_idx on private.account_review_case_photos (object_id);
revoke all on private.photo_perceptual_hashes, private.account_review_case_photos from public, anon, authenticated;

alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior'));
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null) and (signal = 'behavior') = (subject_user is not null));

-- Forget the fingerprints AND perceptual hashes of files the account no longer uses (as 20270357 + hashes).
create or replace function private.forget_unused_photo_fingerprints(p_user uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from private.photo_fingerprints f
   where f.user_id = p_user and not private.photo_object_in_use(p_user, f.object_id);
  delete from private.photo_perceptual_hashes h
   where h.user_id = p_user and not private.photo_object_in_use(p_user, h.object_id);
$function$;
revoke all on function private.forget_unused_photo_fingerprints(uuid) from public, anon, authenticated;

-- Hamming distance of two 64-bit hashes.
create or replace function private.hash_distance(a bigint, b bigint)
returns integer
language sql
immutable
as $function$ select bit_count((a # b)::bit(64))::integer $function$;
revoke all on function private.hash_distance(bigint, bigint) from public, anon, authenticated;

-- Other accounts' in-use photos similar to this object under the approved distances (none while they are null).
create or replace function private.similar_photo_objects(p_object uuid)
returns table (object_id uuid, user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with s as (select similar_photo_max_dhash d, similar_photo_max_phash p from private.account_signal_settings where id),
  mine as (select h.* from private.photo_perceptual_hashes h where h.object_id = p_object)
  select distinct o.object_id, o.user_id
    from s, mine n
    join private.photo_perceptual_hashes o on o.object_id <> n.object_id and o.user_id <> n.user_id
   where s.d is not null and s.p is not null
     and (n.variant = 'full' or o.variant = 'full')
     and private.hash_distance(n.dhash, o.dhash) <= s.d
     and private.hash_distance(n.phash, o.phash) <= s.p
     and private.photo_object_in_use(o.user_id, o.object_id);
$function$;
revoke all on function private.similar_photo_objects(uuid) from public, anon, authenticated;

-- Opens / extends the similar-photo case for one newly hashed photo when an approved rule holds. Never touches accounts.
create or replace function private.evaluate_similar_photo(p_object uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s private.account_signal_settings;
  v_owner uuid;
  v_objects uuid[];
  v_users uuid[];
  v_reason text;
  v_case uuid;
  v_status text;
  v_sha text;
begin
  select * into s from private.account_signal_settings where id;
  if s.similar_photo_max_dhash is null or s.similar_photo_max_phash is null then return; end if;
  if s.duplicate_photo_min_accounts is null and s.similar_name_min_similarity is null then return; end if;
  select h.user_id into v_owner from private.photo_perceptual_hashes h where h.object_id = p_object limit 1;
  if v_owner is null or not private.photo_object_in_use(v_owner, p_object) then return; end if;
  -- one evaluation at a time, so two similar uploads at the same moment can't open two cases for the same photos
  perform pg_advisory_xact_lock(hashtext('similar_photo_cases'));
  -- byte-identical copies are 20270357's (identical_photo); this case is only about copies that differ
  select f.sha256 into v_sha from private.photo_fingerprints f where f.object_id = p_object;
  select array_agg(x.object_id), array_agg(distinct x.user_id) into v_objects, v_users
    from (select p_object as object_id, v_owner as user_id
          union select m.object_id, m.user_id from private.similar_photo_objects(p_object) m
                 where v_sha is null or not exists (select 1 from private.photo_fingerprints f
                                                     where f.object_id = m.object_id and f.sha256 = v_sha)) x;
  if coalesce(cardinality(v_users), 0) < 2 then return; end if;

  -- a photo already in a similar-photo case never opens a second one: the open case grows; a closed one stays closed
  select c.id, c.status into v_case, v_status
    from private.account_review_cases c
   where c.signal = 'similar_photo'
     and exists (select 1 from private.account_review_case_photos cp where cp.case_id = c.id and cp.object_id = any(v_objects))
   order by (c.status = 'open') desc, c.opened_at desc
   limit 1;
  if v_case is not null and v_status <> 'open' then return; end if;

  if s.duplicate_photo_min_accounts is not null and cardinality(v_users) >= s.duplicate_photo_min_accounts then
    v_reason := 'many_accounts';
  elsif s.similar_name_min_similarity is not null and exists (
      select 1 from profiles a join profiles b on a.id < b.id
       where a.id = any(v_users) and b.id = any(v_users)
         and private.normalized_name(a.display_name) is not null
         and private.normalized_name(b.display_name) is not null
         and private.name_similarity(private.normalized_name(a.display_name), private.normalized_name(b.display_name))
             >= s.similar_name_min_similarity) then
    v_reason := 'similar_names';
  end if;
  if v_case is null and v_reason is null then return; end if;

  if v_case is null then
    insert into private.account_review_cases (signal, reason) values ('similar_photo', v_reason) returning id into v_case;
  else
    update private.account_review_cases
       set updated_at = now(),
           reason = case when v_reason = 'many_accounts' then 'many_accounts' else reason end
     where id = v_case;
  end if;
  insert into private.account_review_case_photos (case_id, object_id, user_id)
    select v_case, o.object_id, h.user_id
      from unnest(v_objects) o(object_id)
      join lateral (select user_id from private.photo_perceptual_hashes where object_id = o.object_id limit 1) h on true
    on conflict do nothing;
  insert into private.account_review_case_members (case_id, user_id)
    select v_case, u from unnest(v_users) u
    on conflict do nothing;
end;
$function$;
revoke all on function private.evaluate_similar_photo(uuid) from public, anon, authenticated;

-- Called by moderate-photo (service role) with the hashes of the bytes it downloaded for that exact object:
-- p_hashes = [{variant, dhash, phash}, ...] (signed 64-bit decimal strings). Recorded only while the object is that
-- account's photo and the whole-image variant is present; returns whether it was recorded.
create or replace function public.record_photo_perceptual_hashes(p_user uuid, p_object_id uuid, p_hashes jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e jsonb;
  v_variants text[] := '{}';
begin
  if p_user is null or p_object_id is null or jsonb_typeof(p_hashes) is distinct from 'array'
     or jsonb_array_length(p_hashes) not between 1 and 6 then
    return false;
  end if;
  for e in select * from jsonb_array_elements(p_hashes) loop
    if jsonb_typeof(e) is distinct from 'object'
       or coalesce(e ->> 'variant', '') not in ('full', 'mirror', 'crop90', 'crop90_mirror', 'crop80', 'crop80_mirror')
       or coalesce(e ->> 'dhash', '') !~ '^-?[0-9]{1,19}$' or coalesce(e ->> 'phash', '') !~ '^-?[0-9]{1,19}$'
       or (e ->> 'variant') = any(v_variants) then
      return false;
    end if;
    begin
      perform (e ->> 'dhash')::bigint, (e ->> 'phash')::bigint;
    exception when others then
      return false;
    end;
    v_variants := v_variants || (e ->> 'variant');
  end loop;
  if not ('full' = any(v_variants)) then return false; end if;
  perform private.forget_unused_photo_fingerprints(p_user);
  if not private.photo_object_in_use(p_user, p_object_id) then
    return false;
  end if;
  delete from private.photo_perceptual_hashes where object_id = p_object_id;
  insert into private.photo_perceptual_hashes (object_id, user_id, variant, dhash, phash)
    select p_object_id, p_user, x ->> 'variant', (x ->> 'dhash')::bigint, (x ->> 'phash')::bigint
      from jsonb_array_elements(p_hashes) x;
  perform private.evaluate_similar_photo(p_object_id);
  return true;
end;
$function$;
revoke all on function public.record_photo_perceptual_hashes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_photo_perceptual_hashes(uuid, uuid, jsonb) to service_role;

-- A name change can make an existing similar photo corroborated (as 20270357 does for exact copies).
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
    perform private.evaluate_photo_fingerprint(f.sha256) from private.photo_fingerprints f where f.user_id = new.id;
    perform private.evaluate_similar_photo(h.object_id)
       from (select distinct object_id from private.photo_perceptual_hashes where user_id = new.id) h;
  end if;
  return null;
end;
$function$;
revoke all on function public._fingerprint_main_photo() from public, anon, authenticated;
