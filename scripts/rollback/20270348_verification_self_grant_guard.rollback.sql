-- Rollback for migration 20270348 (no self-granted verification or admin): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270353 -> 20270347); each assumes the later ones were already rolled back.
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
