-- Trust & safety fix 1 (owner, 2026-10-27; audit B1): nobody grants themselves verification or admin rights.
-- Proven before this migration, in rolled-back transactions under the real `authenticated` role:
--   * an existing account could set its own profiles.photo_verified = true (skipping photo screening);
--   * a NEW account could INSERT its own profile with is_admin / is_premium / photo_verified = true (the update guard
--     prevent_self_premium_edit only runs on UPDATE), and an admin can approve ID submissions;
--   * anyone could INSERT their own id_verification_submissions row already 'approved'.
-- Rules (all enforced in the database; "trusted" = a server function that set app.trusted_update = 'true', or a call
-- with no signed-in user, i.e. the service role used by moderate-photo):
--   profiles       INSERT by a signed-in user: every privileged column starts at its default (the same list the update
--                  guard protects, + photo_verified). UPDATE: photo_verified may only go true -> false; a new photo_url
--                  resets it to false (an unscreened photo is never shown as screened) and must sit in the person's own
--                  storage folder.
--   profile_photos INSERT starts unscreened; UPDATE: photo_verified only true -> false, a new photo_url resets it and must
--                  be in the owner's folder, user_id never changes.
--   swap_main_photo(extra id)  the ONE way to make an extra photo the main photo (each keeps its own screening result);
--                  replaces the client's two direct updates that copied the flag (extraPhotos.js setAsMainPhoto).
--   id_verification_submissions  INSERT only as 'pending', unreviewed, manual, both paths inside the person's own folder,
--                  at most one pending submission per person.
--   admin_approve_id_verification  an admin can never review their own submission.
-- Nothing in production changes value: every existing row already satisfies these rules (checked read-only 2026-10-27:
-- 4/4 main + 10/10 extra photo paths in the owner's folder, 0 submissions).

create or replace function public._guard_profile_privileged_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    new.is_admin := false;
    new.is_premium := false;
    new.photo_verified := false;
    new.managed_partner_id := null;
    new.referred_by := null;
    new.bonus_notices := 0;
    new.ai_uses_today := 0;
    new.ai_uses_date := current_date;
    new.browse_views_today := 0;
    new.browse_views_date := current_date;
    new.gatherings_created_today := 0;
    new.gatherings_created_date := null;
    new.communities_created_today := 0;
    new.communities_created_date := null;
    new.friend_requests_sent_today := 0;
    new.friend_requests_sent_date := null;
    new.stories_posted_today := 0;
    new.stories_posted_date := null;
    new.contacts_matched_calls_today := 0;
    new.contacts_matched_date := null;
    if new.photo_url is not null and split_part(new.photo_url, '/', 1) <> new.id::text then
      raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._guard_profile_photo_screening()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.photo_url is distinct from old.photo_url then
      if new.photo_url is not null and split_part(new.photo_url, '/', 1) <> old.id::text then
        raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
      end if;
      new.photo_verified := false;
    elsif coalesce(new.photo_verified, false) and not coalesce(old.photo_verified, false) then
      new.photo_verified := old.photo_verified;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists a_guard_profile_privileged_insert on public.profiles;
create trigger a_guard_profile_privileged_insert before insert on public.profiles
  for each row execute function public._guard_profile_privileged_insert();
drop trigger if exists block_client_photo_screening_edit on public.profiles;
create trigger block_client_photo_screening_edit before update on public.profiles
  for each row execute function public._guard_profile_photo_screening();

create or replace function public._guard_extra_photo_screening()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if tg_op = 'INSERT' then
      new.photo_verified := false;
      if new.photo_url is null or split_part(new.photo_url, '/', 1) <> new.user_id::text then
        raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
      end if;
    else
      new.user_id := old.user_id;
      if new.photo_url is distinct from old.photo_url then
        if new.photo_url is null or split_part(new.photo_url, '/', 1) <> old.user_id::text then
          raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
        end if;
        new.photo_verified := false;
      elsif coalesce(new.photo_verified, false) and not coalesce(old.photo_verified, false) then
        new.photo_verified := old.photo_verified;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists block_client_extra_photo_screening_edit on public.profile_photos;
create trigger block_client_extra_photo_screening_edit before insert or update on public.profile_photos
  for each row execute function public._guard_extra_photo_screening();

revoke all on function public._guard_profile_privileged_insert() from public, anon, authenticated;
revoke all on function public._guard_profile_photo_screening() from public, anon, authenticated;
revoke all on function public._guard_extra_photo_screening() from public, anon, authenticated;

-- An extra photo becomes the main one; the old main photo takes its place among the extras. Each photo keeps its own
-- screening result (photos are swapped, results are never copied from the client).
create or replace function public.swap_main_photo(extra_photo_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_extra record;
  v_main_url text;
  v_main_verified boolean;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select id, photo_url, photo_verified into v_extra from profile_photos where id = extra_photo_id_param and user_id = v_me for update;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  select photo_url, coalesce(photo_verified, false) into v_main_url, v_main_verified from profiles where id = v_me for update;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set photo_url = v_extra.photo_url, photo_verified = coalesce(v_extra.photo_verified, false) where id = v_me;
  if v_main_url is not null then
    update profile_photos set photo_url = v_main_url, photo_verified = v_main_verified where id = v_extra.id;
  else
    delete from profile_photos where id = v_extra.id;
  end if;
  perform set_config('app.trusted_update', 'false', true);
end;
$function$;

revoke all on function public.swap_main_photo(uuid) from public, anon;
grant execute on function public.swap_main_photo(uuid) to authenticated;

-- ID submissions: a person can only ask for review.
drop policy if exists "Users can create their own submissions" on public.id_verification_submissions;
create policy "Users can create their own submissions" on public.id_verification_submissions
  for insert with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and verification_method = 'manual'
    and split_part(selfie_path, '/', 1) = auth.uid()::text
    and split_part(id_photo_path, '/', 1) = auth.uid()::text
  );

create unique index if not exists id_verification_one_pending_per_person
  on public.id_verification_submissions (user_id) where status = 'pending';

-- Same body as live, + an admin never reviews their own submission.
create or replace function public.admin_approve_id_verification(submission_id_param uuid, approved boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review verification submissions';
  end if;

  if exists (select 1 from id_verification_submissions where id = submission_id_param and user_id = auth.uid()) then
    raise exception 'You can''t review your own verification' using errcode = '42501', hint = 'own_submission';
  end if;

  update id_verification_submissions
  set status = case when approved then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = submission_id_param and status = 'pending'
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Submission not found or already reviewed';
  end if;

  if approved then
    perform set_config('app.trusted_update', 'true', true);
    update profiles set photo_verified = true where id = v_user_id;
  end if;
end;
$function$;
