-- Rollback of 20270418: the 20270359 version of _claim_web_business_requests (no profile guard).
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

