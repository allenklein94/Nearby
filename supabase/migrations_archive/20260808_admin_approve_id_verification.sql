-- AdminVerificationScreen.js's approve action does two writes: mark the
-- id_verification_submissions row 'approved' (already works -- that table
-- has a real admin UPDATE policy), then set the submitter's own
-- profiles.photo_verified = true (silently a no-op -- profiles has exactly
-- one UPDATE policy, auth.uid() = id, with no admin bypass, so an admin
-- updating a DIFFERENT user's row affects 0 rows and Supabase's .update()
-- doesn't error on that). Verified live: a real admin session's attempted
-- cross-user update genuinely returned 0 rows updated. Net effect: approving
-- a submission today never actually grants the "verified" badge.
--
-- Fixed with a SECURITY DEFINER RPC doing both writes atomically, checking
-- is_admin internally (matching this codebase's established admin-action
-- pattern, e.g. approve_business_partner_request) rather than opening a
-- broad admin bypass UPDATE policy on all of profiles. Sets
-- app.trusted_update before writing photo_verified, same as every other
-- legitimate write to a prevent_self_premium_edit()-guarded column.
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

revoke all on function public.admin_approve_id_verification(uuid, boolean) from public, anon;
grant execute on function public.admin_approve_id_verification(uuid, boolean) to authenticated;
