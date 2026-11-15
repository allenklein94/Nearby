-- 20270418: an approved web application is never marked claimed while the account has no profile row.
--
-- Website-only business owners (owner, 2026-11-14) can now sign in on the business website and finish their profile
-- there. _claim_web_business_requests runs at approval for any auth user with the applicant's phone; before this, an
-- account with no profile row yet got claimed_at set while the profile UPDATE changed 0 rows, so the profile-created
-- trigger later found nothing to claim and the business never linked. Same function as 20270359 (trusted-write scope
-- kept verbatim) plus one guard. Grants unchanged (revoked from public, anon, authenticated in 20260829; CREATE OR
-- REPLACE keeps them). Production had 0 web applications on 2026-11-14 (read-only check), so nothing to repair.

CREATE OR REPLACE FUNCTION public._claim_web_business_requests(profile_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_trusted text := current_setting('app.trusted_update', true); -- 20270359: the caller's value, put back after the trusted write
  profile_phone text;
  req record;
begin
  select phone into profile_phone from auth.users where id = profile_id_param;
  if profile_phone is null then
    return;
  end if;
  -- 20270418: no profile row yet (signed in, profile not finished) = claim nothing and mark nothing claimed; the
  -- profile-created trigger (on_profile_created_claim_web_business) claims it once the profile exists.
  if not exists (select 1 from public.profiles where id = profile_id_param) then
    return;
  end if;

  for req in
    select * from business_partner_requests
    where source = 'web'
      and status = 'approved'
      and claimed_at is null
      and resulting_partner_id is not null
      and applicant_phone = profile_phone
  loop
    perform set_config('app.trusted_update', 'true', true);
    update profiles set managed_partner_id = req.resulting_partner_id where id = profile_id_param;
    update gatherings set hosting_partner_id = req.resulting_partner_id where host_id = profile_id_param and hosting_partner_id is null;
    update communities set hosting_partner_id = req.resulting_partner_id where creator_id = profile_id_param and hosting_partner_id is null;
    update business_partner_requests set claimed_at = now() where id = req.id;
  end loop;
  perform set_config('app.trusted_update', coalesce(v_caller_trusted, 'false'), true); -- 20270359: trust ends here
end;
$function$;

