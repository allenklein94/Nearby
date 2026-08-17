-- Business Partner acquisition experience, Milestone 2 (see CLAUDE.md): the two review-outcome
-- funnel steps (apply_approved/apply_denied) happen inside the existing admin review RPCs, not
-- client-side -- an applicant never calls these themselves. Pulled both functions' live bodies
-- fresh via the Management API before editing (not reconstructed from an older local copy,
-- matching this repo's own "pull live, don't assume" rule) -- every other line is byte-for-byte
-- unchanged, only the one new insert was added to each, right after the new_partner_id/status
-- update it depends on.
--
-- Both SECURITY DEFINER functions already run as their owner (bypassing RLS entirely, same as
-- every other insert these functions already do into privileged tables), so the new insert needs
-- no special grant -- it's exactly as privileged as the existing `update profiles set
-- managed_partner_id = ...` line right above it. session_id is a fresh gen_random_uuid() here
-- (there is no persisted client session to correlate this admin-driven event back to -- matches
-- the honest disclosure already in 20260817_business_acquisition_events.sql that full anonymous
-- landing-page-to-application attribution isn't attempted in this pass).
create or replace function public.approve_business_partner_request(request_id_param uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req record;
  new_partner_id uuid;
  service_key text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category)
  values (req.business_name, req.business_description, true, req.category)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', req.requester_id,
      'title', 'You''re approved as a partner! 🎉',
      'body', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.',
      'data', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id)
    )
  );

  return new_partner_id;
end;
$function$;

create or replace function public.deny_business_partner_request(request_id_param uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req record;
  service_key text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can deny business partner requests';
  end if;

  update business_partner_requests
  set status = 'denied', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into business_acquisition_events (session_id, user_id, event)
  values (gen_random_uuid(), req.requester_id, 'apply_denied');

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', req.requester_id,
      'title', 'Update on your partner application',
      'body', coalesce(
        nullif(req.admin_notes, ''),
        'Your application for "' || req.business_name || '" wasn''t approved this time. You can submit a new application any time.'
      ),
      'data', jsonb_build_object('type', 'business_partner_denied', 'request_id', request_id_param)
    )
  );
end;
$function$;
