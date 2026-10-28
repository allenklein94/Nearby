-- Rollback for migration 20270349 (no self-granted verification or admin): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270354 -> 20270347); each assumes the later ones were already rolled back.
-- Photo screening bound to the file version (2026-10-28): restore the per-folder storage read, the in-place overwrite
-- policy and the extra-photo row policy exactly as production had them, then remove the new functions and columns.
drop policy if exists "Users can view own or verified profile photos" on storage.objects;
create policy "Users can view own or verified profile photos" on storage.objects for select
  using (((bucket_id = 'profile-photos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE (((p.id)::text = (storage.foldername(objects.name))[1]) AND (p.photo_verified = true)))))));
drop policy if exists "Users can update their own profile photo" on storage.objects;
create policy "Users can update their own profile photo" on storage.objects for update
  using (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
alter policy "Users can view own or verified user's extra photos" on public.profile_photos
  using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = profile_photos.user_id) AND (p.photo_verified = true) AND (p.profile_hidden = false))))));
drop function if exists public.profile_photo_object_visible(uuid, text);
drop function if exists public.photo_screening_target(uuid, uuid);
drop function if exists public.record_photo_screening(uuid, uuid, text, uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_approve_id_verification(submission_id_param uuid, approved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review verification submissions';
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
drop index if exists public.id_verification_one_pending_per_person;
drop policy if exists "Users can create their own submissions" on public.id_verification_submissions;
create policy "Users can create their own submissions" on public.id_verification_submissions for insert with check (auth.uid() = user_id);
drop function if exists public.swap_main_photo(uuid);
drop trigger if exists block_client_extra_photo_screening_edit on public.profile_photos;
drop function if exists public._guard_extra_photo_screening();
drop trigger if exists block_client_photo_screening_edit on public.profiles;
drop function if exists public._guard_profile_photo_screening();
drop trigger if exists a_guard_profile_privileged_insert on public.profiles;
drop function if exists public._guard_profile_privileged_insert();
alter table public.profiles drop column if exists photo_object_id;
alter table public.profile_photos drop column if exists screened_object_id;
