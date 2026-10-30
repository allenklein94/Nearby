-- Rollback for migration 20270368 (similar photo signals). Run after rolling back 20270369, before 20270367 and earlier.
-- WARNING: deletes every perceptual hash and every similar-photo case (open and closed) with its admin note. Export
-- first if needed:  select * from private.account_review_cases where signal = 'similar_photo';
-- Redeploy moderate-photo from the commit before 20270368 (or leave it: it skips the hashes when the function is gone).
drop function if exists public.record_photo_perceptual_hashes(uuid, uuid, jsonb);
drop function if exists private.evaluate_similar_photo(uuid);
drop function if exists private.similar_photo_objects(uuid);
drop function if exists private.hash_distance(bigint, bigint);
delete from private.account_review_cases where signal = 'similar_photo';
drop table if exists private.account_review_case_photos;
drop table if exists private.photo_perceptual_hashes;
alter table private.account_signal_settings drop column if exists similar_photo_max_dhash;
alter table private.account_signal_settings drop column if exists similar_photo_max_phash;
alter table private.account_review_cases drop constraint if exists account_review_cases_subject_check;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null) and (signal = 'behavior') = (subject_user is not null));
alter table private.account_review_cases drop constraint if exists account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'behavior'));
-- private.forget_unused_photo_fingerprints(uuid): back to 20270357
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
-- public._fingerprint_main_photo(): back to 20270357
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
