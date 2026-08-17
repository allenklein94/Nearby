-- Business Partner acquisition experience, Milestone 6 (see CLAUDE.md): closes a real gap found
-- while preparing the full end-to-end funnel verification -- 5 of the 11 real named funnel steps
-- (profile_completed/published/first_offer_created/first_consumer_interaction/dashboard_viewed)
-- were defined in the CHECK constraint and read by get_business_acquisition_funnel_stats(), but
-- never actually fired anywhere in the client or server code, since Milestones 2-5 only needed
-- the earlier steps of the funnel. Running the real end-to-end verification with those 5 events
-- still permanently unfired would have proven the funnel table's read side works, not that the
-- funnel itself is real -- so closing them is a genuine prerequisite for Milestone 6, not scope
-- creep. Pulled `approve_business_partner_request()`'s live body fresh via the Management API
-- first (confirmed byte-identical to the last committed migration before touching it) --
-- `published` is added inline, right next to the already-existing `apply_approved` insert, since
-- in this app's real flow there is no separate "publish" action: the business's profile becomes
-- genuinely live the instant an admin approves it (the same `insert into brand_partners (...,
-- active, ...) values (..., true, ...)` two lines up already makes it real and queryable). Firing
-- both events from the same guarded, non-repeatable moment (the function's own `status =
-- 'pending'` match) means neither can double-fire independent of the other.
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

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

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
