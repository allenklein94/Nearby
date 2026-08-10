-- Business Partner Onboarding enrichment — step 2 of the plan in CLAUDE.md.
-- Adds real push notifications to both review RPCs, mirroring
-- notify_gathering_approved()'s / invite_friend_to_gathering()'s exact
-- established net.http_post-to-send-push pattern. No new trigger needed —
-- these RPCs are already the only path into a status change. No gating on
-- a notify_* profile preference: there's no dedicated column for this event
-- type (checked — only notify_matches/notify_messages/notify_waves exist),
-- and invite_friend_to_gathering() already sets the precedent of sending
-- unconditionally for an event with no matching preference column.
-- Every other check/behavior in both functions is byte-for-byte unchanged.

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

  insert into brand_partners (name, description, active)
  values (req.business_name, req.business_description, true)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param;

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

revoke all on function public.approve_business_partner_request(uuid) from public, anon;
grant execute on function public.approve_business_partner_request(uuid) to authenticated;
revoke all on function public.deny_business_partner_request(uuid) from public, anon;
grant execute on function public.deny_business_partner_request(uuid) to authenticated;
