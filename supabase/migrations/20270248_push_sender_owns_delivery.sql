-- Item 125, completion (owner decision 2026-09-28):
--  1. every gathering invitation notifies the invited friend, whichever screen sent it (one INVITATION_SENT path);
--  2. business-request and occasion group-plan invitations (incl. a guest answering an occasion invite) are recorded as
--     the canonical INVITATION_* events, with no new pushes;
--  3. every remaining push goes through ONE sender, _send_push, which owns delivery: an outbox row per push, optional
--     dedupe key, hand-off to send-push that can never roll back the user's action, and a retry of a hand-off that
--     failed. No function other than _push_outbox_deliver calls send-push.

create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  recipient_id uuid not null,
  title text,
  body text,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,                     -- one logical notification = one row (null = the caller has no natural key)
  status text not null default 'pending' check (status in ('pending', 'queued', 'retry', 'failed')),
  attempts integer not null default 0,
  net_request_id bigint,               -- pg_net request id once handed to send-push
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists push_outbox_dedupe_key on public.push_outbox (dedupe_key) where dedupe_key is not null;
create index if not exists push_outbox_retry_idx on public.push_outbox (next_attempt_at) where status = 'retry';
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;

-- The ONLY place a push is handed to send-push. A failed hand-off is kept for retry and never raises, so a push can
-- never roll back the action that caused it. HTTP results after hand-off are not retried: send-push is not
-- idempotent, so a retry there could deliver twice (at most once wins).
create or replace function public._push_outbox_deliver(outbox_id_param bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record;
  v_key text;
  v_req bigint;
begin
  select * into o from push_outbox where id = outbox_id_param for update;
  if not found or o.status not in ('pending', 'retry') then
    return coalesce(o.status, 'missing');
  end if;
  begin
    -- test switch, transaction-local only: lets the journey prove a failed hand-off is kept and retried
    if current_setting('app.push_handoff_test_failure', true) = 'on' then
      raise exception 'simulated hand-off failure';
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_key is null then
      raise exception 'service_role_key is not configured';
    end if;
    select net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('recipient_id', o.recipient_id, 'title', o.title, 'body', o.body, 'data', o.data)
    ) into v_req;
    update push_outbox set status = 'queued', net_request_id = v_req, attempts = attempts + 1, last_error = null,
                           updated_at = now()
    where id = o.id;
    return 'queued';
  exception when others then
    update push_outbox set status = 'retry', attempts = attempts + 1, last_error = left(sqlerrm, 500),
                           next_attempt_at = now() + make_interval(mins => least(5 * (attempts + 1), 20)), updated_at = now()
    where id = o.id;
    return 'retry';
  end;
end;
$function$;
revoke all on function public._push_outbox_deliver(bigint) from public, anon, authenticated;

-- The one sender every push uses. Returns 'queued' | 'retry' (kept, will be retried) | 'duplicate' (this dedupe key
-- was already sent) | 'no_recipient'.
drop function if exists public._send_push(uuid, text, text, jsonb);
create or replace function public._send_push(recipient_id_param uuid, title_param text, body_param text, data_param jsonb,
                                             dedupe_key_param text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  if recipient_id_param is null then
    return 'no_recipient';
  end if;
  insert into push_outbox (recipient_id, title, body, data, dedupe_key)
  values (recipient_id_param, title_param, body_param, coalesce(data_param, '{}'::jsonb), dedupe_key_param)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  return public._push_outbox_deliver(v_id);
end;
$function$;
revoke all on function public._send_push(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- Retry hand-offs that failed (pg_net unavailable, key missing) for up to an hour / 5 attempts, then give up (a
-- reminder delivered hours late is worse than none). Purges old rows: delivered after 7 days, failed after 30.
create or replace function public.retry_push_outbox()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
  v_n integer := 0;
begin
  update push_outbox set status = 'failed', updated_at = now()
  where status = 'retry' and (attempts >= 5 or created_at < now() - interval '1 hour');
  for v_id in select id from push_outbox where status = 'retry' and next_attempt_at <= now() order by id limit 500 loop
    if public._push_outbox_deliver(v_id) = 'queued' then
      v_n := v_n + 1;
    end if;
  end loop;
  delete from push_outbox where status = 'queued' and created_at < now() - interval '7 days';
  delete from push_outbox where status = 'failed' and created_at < now() - interval '30 days';
  return v_n;
end;
$function$;
revoke all on function public.retry_push_outbox() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'retry-push-outbox') then
    perform cron.unschedule('retry-push-outbox');
  end if;
  perform cron.schedule('retry-push-outbox', '*/5 * * * *', 'select public.retry_push_outbox()');
end;
$cron$;

-- The event layer's recipient step now carries a dedupe key per (event, recipient).
alter table public.domain_event_notifications drop constraint if exists domain_event_notifications_outcome_check;
alter table public.domain_event_notifications add constraint domain_event_notifications_outcome_check
  check (outcome in ('sent', 'muted', 'blocked', 'retrying'));

create or replace function public._notify_event_recipient(
  event_id_param bigint, recipient_id_param uuid, mute_ok_param boolean,
  title_param text, body_param text, data_param jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_outcome text;
begin
  if recipient_id_param is null then
    return false;
  end if;
  if exists (select 1 from domain_event_notifications
             where event_id = event_id_param and recipient_id = recipient_id_param and channel = 'push') then
    return false;  -- this event already notified this person
  end if;
  select actor_id into v_actor from domain_events where id = event_id_param;
  if v_actor is not null and v_actor <> recipient_id_param and exists (
       select 1 from blocks
       where (blocker_id = v_actor and blocked_id = recipient_id_param)
          or (blocker_id = recipient_id_param and blocked_id = v_actor)) then
    v_outcome := 'blocked';
  elsif not coalesce(mute_ok_param, true) then
    v_outcome := 'muted';
  else
    v_outcome := case public._send_push(recipient_id_param, title_param, body_param, data_param,
                                        'event:' || event_id_param || ':' || recipient_id_param)
                   when 'retry' then 'retrying' else 'sent' end;
  end if;
  insert into domain_event_notifications (event_id, recipient_id, channel, notification_type, outcome)
  values (event_id_param, recipient_id_param, 'push', coalesce(data_param->>'type', 'unknown'), v_outcome);
  return v_outcome in ('sent', 'retrying');
end;
$function$;

-- INVITATION_SENT: a gathering invitation notifies the invited friend whichever screen sent it (owner decision:
-- invite-friends popup, Create's invite step, Make a Plan, the post-publish panel). Every other invitation kind
-- (community, business-request group plan, occasion group plan, occasion guest link) is recorded only here; the
-- pushes those flows already had are unchanged and still sent by their own function through _send_push.
create or replace function public._on_invitation_sent(e public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite record;
  v_g record;
  v_inviter_name text;
  v_title text;
begin
  if e.object_kind <> 'social_invite' then
    return;
  end if;
  select * into v_invite from social_invites where id = e.object_id;
  if not found or v_invite.invite_type <> 'gathering' or v_invite.status <> 'pending' then return; end if;
  select * into v_g from gatherings where id = v_invite.target_id;
  if not found then return; end if;
  -- never push someone about a gathering whose host they blocked or who blocked them (the inviter block is checked
  -- in _notify_event_recipient), nor a women-only gathering they cannot join: the same rules the popup path enforced
  if exists (select 1 from blocks where (blocker_id = v_g.host_id and blocked_id = v_invite.invitee_id)
                                     or (blocker_id = v_invite.invitee_id and blocked_id = v_g.host_id)) then
    insert into domain_event_notifications (event_id, recipient_id, channel, notification_type, outcome)
    values (e.id, v_invite.invitee_id, 'push', 'gathering_invite', 'blocked') on conflict do nothing;
    return;
  end if;
  if v_g.women_only and lower(coalesce((select gender from profiles where id = v_invite.invitee_id), '')) not in ('female', 'woman') then
    return;
  end if;
  select display_name into v_inviter_name from profiles where id = v_invite.inviter_id;
  v_title := v_g.title;
  perform public._notify_event_recipient(e.id, v_invite.invitee_id,
    coalesce((select notify_planning from profiles where id = v_invite.invitee_id), true),
    coalesce(v_inviter_name, 'A friend') || ' invited you to a gathering',
    coalesce(v_title, 'Check it out') || ' — tap to see the details.',
    jsonb_build_object('type', 'gathering_invite', 'gathering_id', v_invite.target_id));
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Invitation flows record INVITATION_* events; every legacy push goes through _send_push (bodies patched from live).
-- ---------------------------------------------------------------------------------------------------------------
-- _push_offer_submission_result
CREATE OR REPLACE FUNCTION public._push_offer_submission_result(user_id_param uuid, outcome_param text, submission_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title text;
  v_body text;
begin
  v_title := case outcome_param
    when 'published' then 'Your offer was sent'
    when 'needs_changes' then 'Your offer needs changes'
    else 'Your offer couldn''t be sent' end;
  v_body := case outcome_param
    when 'published' then 'It cleared review and the customer can see it now.'
    when 'needs_changes' then 'Open Nearby to see what to change and resend.'
    else 'Open Nearby to see why.' end;
  perform public._send_push(user_id_param, v_title, v_body, jsonb_build_object('type', 'business_offer_review_result', 'submission_id', submission_id_param, 'outcome', outcome_param));
exception when others then
  null; -- a failed push must never fail the write that caused it
end;
$function$;

-- add_plan_organizer
CREATE OR REPLACE FUNCTION public.add_plan_organizer(business_request_id_param uuid, friend_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary_id uuid;
  v_plan record;
  v_host_name text;
  v_wants_notif boolean;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;
  if v_plan.created_by <> auth.uid() then
    raise exception 'Only the plan''s host can add a co-organizer.';
  end if;
  if friend_user_id = auth.uid() then
    raise exception 'You''re already organizing this plan.';
  end if;
  if is_blocked(auth.uid(), friend_user_id) then
    raise exception 'You can''t add this person.';
  end if;
  if friend_user_id = public._surprise_excluded_friend_id_for_business_request(business_request_id_param) then
    raise exception 'This plan is a surprise for that person -- they can''t be added yet.';
  end if;
  if not (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
      and ((f.user_a = auth.uid() and f.user_b = friend_user_id) or (f.user_a = friend_user_id and f.user_b = auth.uid()))
    )
    or exists (
      select 1 from matches m
      where (m.user_a = auth.uid() and m.user_b = friend_user_id) or (m.user_a = friend_user_id and m.user_b = auth.uid())
    )
  ) then
    raise exception 'You can only add a real connected friend as a co-organizer.';
  end if;

  insert into plan_organizers (plan_id, user_id, added_by)
  values (v_plan.id, friend_user_id, auth.uid())
  on conflict (plan_id, user_id) do nothing;

  select display_name into v_host_name from profiles where id = auth.uid();
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = friend_user_id;
  select occasion_type, who_for_name into v_occ_type, v_occ_who
  from public._occasion_context_for_business_request(v_primary_id);

  if v_wants_notif then
    if v_occ_type is not null then
      v_push_title := _occasion_emoji(v_occ_type) || ' You''re a co-organizer';
      v_push_body := coalesce(v_host_name, 'Someone you know') || ' added you as a co-organizer to help plan '
        || case when v_occ_who is not null then v_occ_who || '''s ' else 'their ' end
        || lower(_occasion_noun(v_occ_type)) || '.';
    else
      v_push_title := 'You''re a co-organizer';
      v_push_body := coalesce(v_host_name, 'Someone you know') || ' added you as a co-organizer for ' || coalesce(v_plan.title, 'a plan') || '.';
    end if;

    perform public._send_push(friend_user_id, v_push_title, v_push_body, jsonb_build_object('type', 'plan_organizer_added', 'request_id', v_primary_id));
  end if;

  return jsonb_build_object('planId', v_plan.id, 'addedUserId', friend_user_id);
end;
$function$;

-- approve_business_partner_request
CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  new_partner_id uuid;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory, categories)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory, req.categories)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_partner_id = new_partner_id
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  if req.source = 'web' and req.applicant_phone is not null then
    select id into matched_profile_id from auth.users where phone = req.applicant_phone limit 1;
    if matched_profile_id is not null then
      perform public._claim_web_business_requests(matched_profile_id);
    end if;
  end if;

  if coalesce((select notify_business from profiles where id = req.requester_id), true) then
    perform public._send_push(req.requester_id, 'You''re approved as a partner! 🎉', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id));
  end if;

  return new_partner_id;
end;
$function$;

-- cancel_business_request
CREATE OR REPLACE FUNCTION public.cancel_business_request(request_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_primary_id uuid;
  v_plan record;
  v_is_primary boolean;
  v_actor_name text;
  v_cancelled_partner_ids uuid[];
  v_managing_id uuid;
begin
  select * into v_request from business_requests where id = request_id_param for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request can no longer be cancelled.';
  end if;

  v_is_primary := v_request.parent_request_id is null;
  v_primary_id := coalesce(v_request.parent_request_id, v_request.id);

  if v_is_primary then
    select p.* into v_plan from plans p
    where p.resulting_business_request_id = v_primary_id
    order by p.created_at desc limit 1;

    if v_plan.id is not null then
      if v_plan.created_by <> auth.uid() then
        raise exception 'Only the host can cancel this plan.';
      end if;
    elsif v_request.requester_id <> auth.uid() then
      raise exception 'You do not have permission to cancel this request.';
    end if;
  else
    if not _can_manage_business_request(v_request.id) then
      raise exception 'You do not have permission to cancel this add-on.';
    end if;
  end if;

  select array_agg(distinct partner_id) into v_cancelled_partner_ids
  from business_request_offers
  where request_id = request_id_param and status in ('pending', 'offered');

  update business_requests set status = 'cancelled' where id = request_id_param;
  perform _record_cancellation('business_request', request_id_param, null, 'requester');

  update business_request_offers
  set status = 'cancelled'
  where request_id = request_id_param
  and status in ('pending', 'offered');

  select display_name into v_actor_name from profiles where id = auth.uid();

  -- Item 90: every other real plan participant learns the plan (or one
  -- of its add-ons) was cancelled, not just whoever tapped Cancel.
  perform _notify_other_plan_participants(
    request_id_param,
    auth.uid(),
    case when v_is_primary then 'plan_cancelled' else 'plan_addon_removed' end,
    case when v_is_primary then '🚫 Plan cancelled' else 'Plan updated' end,
    case
      when v_is_primary then coalesce(v_actor_name, 'The host') || ' cancelled this plan.'
      else coalesce(v_actor_name, 'Someone on the plan') || ' removed ' || coalesce(v_request.plan_label, v_request.addon_type, 'an item') || ' from the plan.'
    end
  );

  -- The business(es) whose still-open ask on this row just vanished
  -- deserve to know too -- previously they learned nothing at all.
  if v_cancelled_partner_ids is not null then
    for i in 1 .. array_length(v_cancelled_partner_ids, 1) loop
      for v_managing_id in
        select id from profiles where managed_partner_id = v_cancelled_partner_ids[i]
      loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_id), true);
        perform public._send_push(v_managing_id, 'A request was cancelled', 'A request you were considering was cancelled by the requester.', jsonb_build_object('type', 'business_request_cancelled', 'request_id', request_id_param));
      end loop;
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

-- cancel_business_reservation
CREATE OR REPLACE FUNCTION public.cancel_business_reservation(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_partner_id uuid;
  v_is_business boolean;
  v_partner_name text;
  v_actor_name text;
  v_managing_profiles uuid[];
  v_result jsonb;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be cancelled.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is not null and v_partner_id = v_offer.partner_id then
    v_is_business := true;
  elsif auth.uid() = v_request.requester_id then
    v_is_business := false;
  else
    raise exception 'You are not part of this reservation.';
  end if;

  v_result := _cancel_reservation_by_offer(offer_id_param);
  if not (v_result->>'cancelled')::boolean then
    if v_result->>'reason' = 'payment_captured' then
      raise exception 'This reservation has already been paid for. Contact the business directly to arrange a refund.';
    else
      raise exception 'This reservation is not in a state that can be cancelled.';
    end if;
  end if;

  perform _record_cancellation('business_reservation', offer_id_param, v_offer.partner_id, case when v_is_business then 'business' else 'requester' end);


  if v_is_business then
    if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
      perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The business cancelled your reservation for "' || left(v_request.raw_text, 60) || '"', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', offer_id_param));
    end if;

    -- Item 90: every other real plan participant learns the business
    -- cancelled too, not just the original requester.
    perform _notify_other_plan_participants(
      v_request.id, v_request.requester_id, 'plan_reservation_cancelled',
      'Your reservation was cancelled',
      'The business cancelled the reservation for "' || left(v_request.raw_text, 60) || '"',
      jsonb_build_object('offer_id', offer_id_param)
    );
  else
    select name into v_partner_name from brand_partners where id = v_offer.partner_id;
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'A customer cancelled their reservation: ' || public.business_safe_request_summary(v_request.id), jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', offer_id_param));
      end loop;
    end if;

    -- Item 90: every other real plan participant learns whoever cancelled
    -- did so, not just the business.
    select display_name into v_actor_name from profiles where id = auth.uid();
    perform _notify_other_plan_participants(
      v_request.id, auth.uid(), 'plan_reservation_cancelled',
      'A reservation was cancelled',
      coalesce(v_actor_name, 'Someone on the plan') || ' cancelled the reservation for "' || left(v_request.raw_text, 60) || '"',
      jsonb_build_object('offer_id', offer_id_param)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

-- cancel_community
CREATE OR REPLACE FUNCTION public.cancel_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_name text;
  member_row record;
  v_accepted_offer record;
  v_cancel_result jsonb;
  v_request record;
  v_managing_profiles uuid[];
begin
  select status, name into v_status, v_name from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This community is already cancelled.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'cancelled' where id = community_id_param;
  perform _record_cancellation('community', community_id_param, null, 'host');


  for v_accepted_offer in
    select o.id as offer_id, o.partner_id, o.request_id
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where r.community_id = community_id_param and o.status = 'accepted'
  loop
    select * into v_request from business_requests where id = v_accepted_offer.request_id;
    v_cancel_result := _cancel_reservation_by_offer(v_accepted_offer.offer_id);
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_accepted_offer.partner_id;

    if (v_cancel_result->>'cancelled')::boolean then
      if v_request.requester_id <> auth.uid() and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The community "' || v_name || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'The community "' || v_name || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation', 'The community "' || v_name || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform public._send_push(v_managing_profiles[i], 'A community was cancelled', 'The community behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    end if;
  end loop;

  update business_requests set status = 'cancelled'
    where community_id = community_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where community_id = community_id_param)
      and status in ('pending', 'offered');

  for member_row in
    select user_id from community_members where community_id = community_id_param and user_id <> auth.uid()
  loop
    continue when not coalesce((select notify_community from profiles where id = member_row.user_id), true);
    perform public._send_push(member_row.user_id, 'A community was cancelled', '"' || v_name || '" has been cancelled by its creator.', jsonb_build_object('type', 'community_cancelled'));
  end loop;

  return jsonb_build_object('success', true);
end;
$function$;

-- cancel_gathering
CREATE OR REPLACE FUNCTION public.cancel_gathering(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scheduled_at timestamptz;
  v_title text;
  v_accepted_offer record;
  v_cancel_result jsonb;
  v_request record;
  v_managing_profiles uuid[];
begin
  select scheduled_at, title into v_scheduled_at, v_title from gatherings where id = gathering_id_param and host_id = auth.uid() for update;
  if v_scheduled_at is null then
    raise exception 'Gathering not found.';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened and can no longer be cancelled.';
  end if;

  perform _record_cancellation('gathering', gathering_id_param, null, 'host');


  for v_accepted_offer in
    select o.id as offer_id, o.partner_id, o.request_id
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where r.gathering_id = gathering_id_param and o.status = 'accepted'
  loop
    select * into v_request from business_requests where id = v_accepted_offer.request_id;
    v_cancel_result := _cancel_reservation_by_offer(v_accepted_offer.offer_id);
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_accepted_offer.partner_id;

    if (v_cancel_result->>'cancelled')::boolean then
      if v_request.requester_id <> auth.uid() and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The gathering "' || v_title || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'The gathering "' || v_title || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation', 'The gathering "' || v_title || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform public._send_push(v_managing_profiles[i], 'A customer''s gathering was cancelled', 'The gathering behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    end if;
  end loop;

  update plans set status = 'cancelled' where resulting_gathering_id = gathering_id_param;

  update business_requests set status = 'cancelled'
    where gathering_id = gathering_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where gathering_id = gathering_id_param)
      and status in ('pending', 'offered');

  delete from gatherings where id = gathering_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

-- cancel_occasion_group_plan
CREATE OR REPLACE FUNCTION public.cancel_occasion_group_plan(plan_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan occasion_group_plans%rowtype;
  v_child plans%rowtype;
  v_offer record;
  v_res jsonb;
  v_participant record;
  v_wants boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if not found or v_plan.status not in ('voting', 'voting_business', 'decided', 'fulfilled') then
    raise exception 'This plan cannot be cancelled.';
  end if;

  perform _record_cancellation('occasion_group_plan', plan_id_param, null, 'host');
  -- The cascade below is part of this one cancellation, not separate ones to analyze.
  perform set_config('app.cancel_cascade', 'true', true);

  -- Everything that was made from this plan (only exists once it is fulfilled).
  select * into v_child from plans where id = v_plan.resulting_plan_id;
  if v_child.id is not null and v_child.status <> 'completed' then
    if v_child.resulting_business_request_id is not null then
      for v_offer in
        select o.id from business_request_offers o
        where o.status = 'accepted'
          and o.request_id in (select id from business_requests
                               where id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id)
      loop
        v_res := _cancel_reservation_by_offer(v_offer.id);
        if v_res->>'reason' = 'payment_captured' then
          raise exception 'A payment has already been made for this plan. Contact the business directly to arrange a refund.';
        end if;
      end loop;
      update business_request_offers set status = 'cancelled'
      where status in ('pending', 'offered')
        and request_id in (select id from business_requests
                           where id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id);
      update business_requests set status = 'cancelled'
      where status = 'open' and (id = v_child.resulting_business_request_id or parent_request_id = v_child.resulting_business_request_id);
    end if;
    if v_child.resulting_gathering_id is not null then
      -- Only the gathering's own host can cancel it (cancel_gathering checks); a gathering someone else hosts, or one that
      -- already happened, is left alone rather than blocking the cancellation.
      begin
        perform cancel_gathering(v_child.resulting_gathering_id);
      exception when others then
        null;
      end;
    end if;
    update plans set status = 'cancelled' where id = v_child.id and status <> 'completed';
  end if;

  update occasion_group_plans set status = 'cancelled', cancelled_at = now() where id = plan_id_param;

  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status in ('invited', 'joined') and user_id is not null and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants from profiles where id = v_participant.user_id;
    if v_wants then
      perform public._send_push(v_participant.user_id, '🚫 Plan cancelled', v_plan.title || ' was cancelled by the host.', jsonb_build_object('type', 'occasion_group_plan_cancelled', 'plan_id', plan_id_param));
    end if;
  end loop;
end;
$function$;

-- check_mutual_notice
CREATE OR REPLACE FUNCTION public.check_mutual_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  matched_user_a uuid;
  matched_user_b uuid;
  new_match_id uuid;
  sender_name text;
  recipient_name text;
  to_user_wants_notif boolean;
  from_user_wants_notif boolean;
begin
  if exists (
    select 1 from notices
    where from_user = new.to_user and to_user = new.from_user
  ) then
    matched_user_a := least(new.from_user, new.to_user);
    matched_user_b := greatest(new.from_user, new.to_user);
    insert into matches (user_a, user_b)
    values (matched_user_a, matched_user_b)
    on conflict do nothing
    returning id into new_match_id;
    if new_match_id is not null then
      select display_name into sender_name from profiles where id = new.from_user;
      select display_name into recipient_name from profiles where id = new.to_user;

      select coalesce(notify_dating, true) into to_user_wants_notif from profiles where id = new.to_user;
      select coalesce(notify_dating, true) into from_user_wants_notif from profiles where id = new.from_user;

      if to_user_wants_notif then
        perform public._send_push(new.to_user, 'It''s a Match! 🎉', 'You and ' || coalesce(sender_name, 'someone') || ' noticed each other.', jsonb_build_object('type', 'new_match', 'match_id', new_match_id));
      end if;

      if from_user_wants_notif then
        perform public._send_push(new.from_user, 'It''s a Match! 🎉', 'You and ' || coalesce(recipient_name, 'someone') || ' noticed each other.', jsonb_build_object('type', 'new_match', 'match_id', new_match_id));
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- confirm_group_plan
CREATE OR REPLACE FUNCTION public.confirm_group_plan(proposal_id_param uuid, exclude_user_ids_param uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_final_party_size integer := 0;
  v_final_count integer := 0;
  v_has_blocked_pair boolean;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_count integer;
  v_lat double precision;
  v_lng double precision;
  v_notify_row record;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can confirm it.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan has already been confirmed or cancelled.';
  end if;
  if v_proposal.agreed_budget_max is null then
    raise exception 'Set an agreed budget before confirming the group plan.';
  end if;

  -- Explicit initiator choice: removes someone even if they already
  -- accepted ("continue without Sarah" after she said yes).
  update group_plan_participants
  set status = 'left'
  where proposal_id = proposal_id_param and user_id = any(coalesce(exclude_user_ids_param, array[]::uuid[]));

  select coalesce(sum(party_size + guest_count), 0), count(*)
  into v_final_party_size, v_final_count
  from group_plan_participants
  where proposal_id = proposal_id_param and status = 'accepted';

  if v_final_count < 2 then
    raise exception 'A group plan needs at least 2 people who have accepted.';
  end if;

  -- Real all-pairs block check across the final accepted roster (post any
  -- initiator exclusion above). A generic message, same posture as every
  -- other blocked-pair rejection in this schema -- never reveals which side
  -- blocked which.
  select exists (
    select 1
    from group_plan_participants gpp1
    join group_plan_participants gpp2
      on gpp1.proposal_id = gpp2.proposal_id and gpp1.user_id < gpp2.user_id
    join blocks b
      on (b.blocker_id = gpp1.user_id and b.blocked_id = gpp2.user_id)
      or (b.blocker_id = gpp2.user_id and b.blocked_id = gpp1.user_id)
    where gpp1.proposal_id = proposal_id_param
      and gpp1.status = 'accepted'
      and gpp2.status = 'accepted'
  ) into v_has_blocked_pair;

  if v_has_blocked_pair then
    raise exception 'This group can''t be confirmed as-is. Review who''s accepted and exclude someone if needed, then try again.';
  end if;

  -- Finalizing the roster: anyone who never actually accepted (still
  -- invited, or declined) is not part of the confirmed group.
  update group_plan_participants
  set status = 'left'
  where proposal_id = proposal_id_param and status in ('invited', 'declined');

  v_expires_at := case
    when v_proposal.date is not null and v_proposal.time_window_end is not null then (v_proposal.date + v_proposal.time_window_end)::timestamptz
    when v_proposal.date is not null then (v_proposal.date + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  -- Real coordinates from the initiator's own already-collected source
  -- request -- never re-typed, same discipline Phase 3's gathering-
  -- sourced requests already established.
  select br.latitude, br.longitude into v_lat, v_lng
  from business_requests br
  join group_plan_participants gpp on gpp.source_request_id = br.id
  where gpp.proposal_id = proposal_id_param and gpp.user_id = v_proposal.initiator_id;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, group_plan_id, dietary
  ) values (
    v_proposal.initiator_id,
    'Group plan: ' || v_proposal.category || ' for ' || v_final_party_size || ' people',
    v_proposal.category, v_final_party_size, v_proposal.agreed_budget_max,
    v_proposal.date, v_proposal.time_window_start, v_proposal.time_window_end,
    v_lat, v_lng, v_proposal.radius_miles, v_expires_at, proposal_id_param,
    coalesce((
      select array_agg(distinct x.d order by x.d) from (
        select unnest(gpd.dietary) as d
        from group_plan_participants gpp
        join group_plan_participant_dietary gpd on gpd.proposal_id = gpp.proposal_id and gpd.user_id = gpp.user_id
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted'
        union
        select unnest(sbr.dietary)
        from group_plan_participants gpp
        join business_requests sbr on sbr.id = gpp.source_request_id
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted'
      ) x
    ), '{}')
  ) returning id into v_request_id;

  update business_requests br
  set status = 'merged', superseded_by_group_plan_id = proposal_id_param
  from group_plan_participants gpp
  where gpp.proposal_id = proposal_id_param
  and gpp.status = 'accepted'
  and br.id = gpp.source_request_id
  and br.status = 'open';

  -- Finding C1's actual fix: a merged parent's own already-generated
  -- offers were never touched before this line -- they were left
  -- pending/offered forever, rendered as a blank row on the business
  -- dashboard and a live-but-always-rejected "Accept This Offer" button
  -- on the consumer's own request-detail screen. Expired, not cancelled
  -- -- the terms weren't declined, they were superseded by the group
  -- plan's own new shared request.
  update business_request_offers bro
  set status = 'expired'
  from group_plan_participants gpp
  where gpp.proposal_id = proposal_id_param
  and gpp.status = 'accepted'
  and bro.request_id = gpp.source_request_id
  and bro.status in ('pending', 'offered');

  update group_plan_proposals
  set status = 'confirmed', confirmed_at = now(), resulting_request_id = v_request_id
  where id = proposal_id_param;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, v_proposal.radius_miles) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, v_proposal.radius_miles, v_proposal.category, v_proposal.date, v_proposal.time_window_start, v_proposal.time_window_end) into v_avail_count;
  v_notified_count := v_notified_count + coalesce(v_avail_count, 0);

  for v_notify_row in
    select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted' and user_id <> v_proposal.initiator_id
  loop
    continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
    perform public._send_push(v_notify_row.user_id, 'Your group plan is live!', 'Your ' || v_proposal.category || ' group plan was sent to nearby businesses.', jsonb_build_object('type', 'group_plan_confirmed', 'proposal_id', proposal_id_param, 'request_id', v_request_id));
  end loop;

  return jsonb_build_object('success', true, 'requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_final_party_size);
end;
$function$;

-- confirm_group_plan_offer
CREATE OR REPLACE FUNCTION public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_offer record;
  v_participant record;
  v_required_count integer;
  v_confirmed_count integer;
  v_accept_result jsonb;
  v_notify_row record;
  v_occ_type text;
  v_occ_who text;
  v_final_title text;
  v_final_body text;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.status <> 'confirmed' or v_proposal.resulting_request_id is null then
    raise exception 'This group plan has not been finalized into a real request yet.';
  end if;

  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_offer.request_id <> v_proposal.resulting_request_id then
    raise exception 'This offer does not belong to this group plan.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available to confirm.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = auth.uid() and status = 'accepted';
  if v_participant is null then
    raise exception 'You are not an active participant in this group plan.';
  end if;

  insert into group_plan_offer_confirmations (proposal_id, offer_id, user_id)
  values (proposal_id_param, offer_id_param, auth.uid())
  on conflict (offer_id, user_id) do nothing;

  select count(*) into v_required_count from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted';
  select count(*) into v_confirmed_count from group_plan_offer_confirmations where proposal_id = proposal_id_param and offer_id = offer_id_param;


  if v_confirmed_count < v_required_count then
    for v_notify_row in
      select gpp.user_id from group_plan_participants gpp
      where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted' and gpp.user_id <> auth.uid()
      and not exists (select 1 from group_plan_offer_confirmations c where c.offer_id = offer_id_param and c.user_id = gpp.user_id)
    loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
      perform public._send_push(v_notify_row.user_id, 'Confirm your group plan offer', 'Someone in your group confirmed a business offer -- confirm your spot too.', jsonb_build_object('type', 'group_plan_offer_pending', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param));
    end loop;
    return jsonb_build_object('success', true, 'allConfirmed', false, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count);
  end if;

  v_accept_result := public._accept_business_offer_internal(offer_id_param);

  -- Item 125: everyone confirmed = the offer is accepted; the notification layer tells the business and the group.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'confirm_group_plan_offer',
    jsonb_build_object('request_id', v_proposal.resulting_request_id, 'offer_id', offer_id_param, 'proposal_id', proposal_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object('success', true, 'allConfirmed', true, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count) || v_accept_result;
end;
$function$;

-- create_occasion_group_plan
CREATE OR REPLACE FUNCTION public.create_occasion_group_plan(occasion_type_param text, title_param text, who_for_name_param text, who_for_friend_id_param uuid, when_preset_param text, scheduled_date_param date, invitee_ids_param uuid[], surprise_mode_param boolean DEFAULT false, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, experience_level_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_part_id uuid;
  v_plan_id uuid;
  v_invitee_id uuid;
  v_invited_count integer := 0;
  v_host_name text;
  v_wants_notif boolean;
begin
  if title_param is null or trim(title_param) = '' then
    raise exception 'This occasion needs a title.';
  end if;
  if budget_min_param is not null and budget_max_param is not null and budget_min_param > budget_max_param then
    raise exception 'Budget minimum can''t be more than the maximum.';
  end if;
  if experience_level_param is not null and experience_level_param not in ('simple', 'special', 'go_all_out') then
    raise exception 'Invalid experience level';
  end if;

  insert into occasion_group_plans (
    host_id, occasion_type, title, who_for_name, who_for_friend_id, when_preset, scheduled_date,
    surprise_mode, budget_min, budget_max, experience_level
  ) values (
    auth.uid(), occasion_type_param, trim(title_param), who_for_name_param, who_for_friend_id_param,
    when_preset_param, scheduled_date_param, coalesce(surprise_mode_param, false), budget_min_param, budget_max_param,
    experience_level_param
  ) returning id into v_plan_id;

  insert into occasion_group_plan_participants (group_plan_id, user_id, status, responded_at)
  values (v_plan_id, auth.uid(), 'joined', now());

  -- Item 99: the occasion's own already-known date is the natural first
  -- real candidate -- never fabricated, it's exactly what the host already
  -- typed into this same call.
  if scheduled_date_param is not null then
    insert into occasion_group_plan_date_options (group_plan_id, option_date, proposed_by)
    values (v_plan_id, scheduled_date_param, auth.uid())
    on conflict (group_plan_id, option_date) do nothing;
  end if;

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = auth.uid();
      continue when is_blocked(auth.uid(), v_invitee_id);
      continue when coalesce(surprise_mode_param, false) and who_for_friend_id_param is not null and v_invitee_id = who_for_friend_id_param;

      if not (
        exists (
          select 1 from friendships f
          where f.status = 'accepted'
          and ((f.user_a = auth.uid() and f.user_b = v_invitee_id) or (f.user_a = v_invitee_id and f.user_b = auth.uid()))
        )
        or exists (
          select 1 from matches m
          where (m.user_a = auth.uid() and m.user_b = v_invitee_id) or (m.user_a = v_invitee_id and m.user_b = auth.uid())
        )
      ) then
        continue;
      end if;

      begin
        insert into occasion_group_plan_participants (group_plan_id, user_id, status)
        values (v_plan_id, v_invitee_id, 'invited')
        returning id into v_part_id;
        v_invited_count := v_invited_count + 1;
        -- Item 125: recorded as INVITATION_SENT (this flow's own push below is unchanged)
        perform public._emit_event('INVITATION_SENT', 'occasion_group_plan_participant', v_part_id, auth.uid(), 'create_occasion_group_plan',
      jsonb_build_object('participant_id', v_part_id, 'plan_id', v_plan_id, 'invitee_id', v_invitee_id), 'INVITATION_SENT:' || v_part_id);
      exception when unique_violation then
        continue;
      end;

      select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
      if v_wants_notif then
        perform public._send_push(v_invitee_id, '🗳️ You''re invited to plan together', coalesce(v_host_name, 'Someone you know') || ' wants your vote on ' || trim(title_param) || '.', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', v_plan_id));
      end if;
    end loop;
  end if;

  return jsonb_build_object('planId', v_plan_id, 'invitedCount', v_invited_count);
end;
$function$;

-- decide_occasion_group_plan
CREATE OR REPLACE FUNCTION public.decide_occasion_group_plan(plan_id_param uuid, option_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_option record;
  v_party_size integer;
  v_participant record;
  v_wants_notif boolean;
  v_is_business boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'This plan has already been decided or cancelled.';
  end if;

  select * into v_option from occasion_group_plan_options where id = option_id_param and group_plan_id = plan_id_param;
  if v_option is null then
    raise exception 'That option does not belong to this plan.';
  end if;

  select count(*) into v_party_size from occasion_group_plan_participants
  where group_plan_id = plan_id_param and status = 'joined';

  v_is_business := v_option.activity_type in ('dinner', 'night_out', 'activity');

  if v_is_business then
    update occasion_group_plans
    set status = 'voting_business', winning_option_id = option_id_param
    where id = plan_id_param;
  else
    update occasion_group_plans
    set status = 'decided', winning_option_id = option_id_param, decided_at = now()
    where id = plan_id_param;
  end if;


  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if v_wants_notif then
      perform public._send_push(v_participant.user_id, case when v_is_business then '🍽️ Vote on where!' else '🎉 It''s decided!' end, case when v_is_business
            then v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won -- Nearby is finding real options for the group to vote on.'
            else v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won the vote.'
          end, jsonb_build_object(
            'type', case when v_is_business then 'occasion_group_plan_voting_business' else 'occasion_group_plan_decided' end,
            'plan_id', plan_id_param
          ));
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when v_is_business then 'voting_business' else 'decided' end,
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'activityType', v_option.activity_type,
    'label', v_option.label,
    'partySize', greatest(v_party_size, 1),
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max,
    'experienceLevel', v_plan.experience_level
  );
end;
$function$;

-- decide_occasion_group_plan_business
CREATE OR REPLACE FUNCTION public.decide_occasion_group_plan_business(plan_id_param uuid, option_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_option record;
  v_partner_name text;
  v_posting_title text;
  v_still_live boolean;
  v_participant record;
  v_wants_notif boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting_business' then
    raise exception 'This plan is not currently voting on businesses.';
  end if;

  select * into v_option from occasion_group_plan_options
  where id = option_id_param and group_plan_id = plan_id_param and option_kind = 'business';
  if v_option is null then
    raise exception 'That option does not belong to this plan.';
  end if;

  select bp.name, ba.title, (
    ba.status = 'active' and ba.ends_at > now() and (ba.remaining_capacity is null or ba.remaining_capacity > 0) and bp.active
  ) into v_partner_name, v_posting_title, v_still_live
  from business_availability ba
  join brand_partners bp on bp.id = ba.partner_id
  where ba.id = v_option.business_availability_id;

  if v_still_live is not true then
    raise exception 'That option is no longer available -- please pick a different one or find new options.';
  end if;

  update occasion_group_plans
  set status = 'decided', winning_option_id = option_id_param, decided_at = now()
  where id = plan_id_param;


  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if v_wants_notif then
      perform public._send_push(v_participant.user_id, '🎉 It''s decided!', v_plan.title || ': ' || coalesce(v_partner_name, 'a business') || ' won the vote.', jsonb_build_object('type', 'occasion_group_plan_decided', 'plan_id', plan_id_param));
    end if;
  end loop;

  return jsonb_build_object('partnerName', v_partner_name, 'postingTitle', v_posting_title);
end;
$function$;

-- decline_business_offer
CREATE OR REPLACE FUNCTION public.decline_business_offer(request_id_param uuid, reason_param text, note_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_none_left boolean;
begin
  if reason_param not in (
    'too_far',
    'too_busy_right_now',
    'cant_accommodate_group_size',
    'outside_our_hours',
    'not_a_fit_for_us',
    'other'
  ) then
    raise exception 'Invalid decline reason.';
  end if;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status not in ('pending', 'offered') then
    raise exception 'This request has already been resolved.';
  end if;

  update business_request_offers
  set status = 'declined',
      responded_at = now(),
      decline_reason = reason_param,
      decline_note = case when reason_param = 'other' then note_param else null end
  where id = v_row.id;

  select requester_id, raw_text into v_requester_id, v_raw_text from business_requests where id = request_id_param;
  select name into v_partner_name from brand_partners where id = v_partner_id;

  select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(request_id_param);
  if v_occ_type is not null then
    v_push_title := _occasion_emoji(v_occ_type) || ' An update on your ' || lower(_occasion_noun(v_occ_type)) || ' plan';
    v_push_body := coalesce(v_partner_name, 'A business') || ' can''t accommodate your request'
      || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '. Try another business nearby.';
  else
    v_push_title := 'An update on your request';
    v_push_body := coalesce(v_partner_name, 'A business') || ' can''t accommodate "' || left(coalesce(v_raw_text, ''), 60) || '"';
  end if;

  -- State-machine audit gap 6: this decline may leave the request with nobody left to answer it. Derived, not stored: the
  -- request is still open and no offer is live (pending/offered) or won (accepted/completed).
  select exists (select 1 from business_requests where id = request_id_param and status = 'open')
     and not exists (select 1 from business_request_offers
                     where request_id = request_id_param and status in ('pending', 'offered', 'accepted', 'completed'))
    into v_none_left;
  if v_none_left then
    v_push_title := 'Nobody is available yet';
    v_push_body := 'Every business we asked has passed on "' || left(coalesce(v_raw_text, ''), 60) || '". Try widening your search.';
  end if;

  if coalesce((select notify_business from profiles where id = v_requester_id), true) then
    perform public._send_push(v_requester_id, v_push_title, v_push_body, jsonb_build_object('type', case when v_none_left then 'business_request_all_declined' else 'business_offer_declined' end, 'request_id', request_id_param));
  end if;

  perform _notify_other_plan_participants(request_id_param, v_requester_id, case when v_none_left then 'business_request_all_declined' else 'business_offer_declined' end, v_push_title, v_push_body);

  return jsonb_build_object('success', true);
end;
$function$;

-- deny_business_partner_request
CREATE OR REPLACE FUNCTION public.deny_business_partner_request(request_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
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

  if coalesce((select notify_business from profiles where id = req.requester_id), true) then
    perform public._send_push(req.requester_id, 'Update on your partner application', coalesce(
          nullif(req.admin_notes, ''),
          'Your application for "' || req.business_name || '" wasn''t approved this time. You can submit a new application any time.'
        ), jsonb_build_object('type', 'business_partner_denied', 'request_id', request_id_param));
  end if;
end;
$function$;

-- generate_next_recurring_gathering
CREATE OR REPLACE FUNCTION public.generate_next_recurring_gathering()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  past_recurring record;
  next_scheduled_at timestamptz;
  interval_step interval;
  new_gathering_id uuid;
  past_attendee record;
begin

  for past_recurring in
    select g.*
    from gatherings g
    where g.recurring_series_id is not null
    and g.scheduled_at < now()
    and g.series_stopped = false
    and not exists (
      select 1 from gatherings g2
      where g2.recurring_series_id = g.recurring_series_id
      and g2.scheduled_at >= now()
    )
    and not exists (
      select 1 from gatherings g4
      where g4.recurring_series_id = g.recurring_series_id
      and g4.series_stopped = true
    )
    and g.id = (
      select g3.id from gatherings g3
      where g3.recurring_series_id = g.recurring_series_id
      order by g3.scheduled_at desc
      limit 1
    )
  loop
    interval_step := case past_recurring.recurrence_rule
      when 'weekly' then interval '7 days'
      when 'biweekly' then interval '14 days'
      when 'monthly' then interval '1 month'
      else null
    end;

    if interval_step is not null then
      -- Keep advancing by the interval until we land on a genuinely
      -- future date — if an instance was cancelled and this cron
      -- didn't run for a while, blindly adding one interval to the
      -- last known date could still land in the past.
      next_scheduled_at := past_recurring.scheduled_at + interval_step;
      while next_scheduled_at <= now() loop
        next_scheduled_at := next_scheduled_at + interval_step;
      end loop;

      insert into gatherings (
        host_id, title, description, interest_tag, area, scheduled_at, wide_area,
        is_public, show_on_map, women_only, community_id, hosting_partner_id,
        recurrence_rule, recurring_series_id
      )
      values (
        past_recurring.host_id, past_recurring.title, past_recurring.description, past_recurring.interest_tag,
        past_recurring.area, next_scheduled_at, past_recurring.wide_area,
        past_recurring.is_public, past_recurring.show_on_map, past_recurring.women_only,
        past_recurring.community_id, past_recurring.hosting_partner_id,
        past_recurring.recurrence_rule, past_recurring.recurring_series_id
      )
      returning id into new_gathering_id;

      for past_attendee in
        select distinct gi.user_id
        from gathering_interest gi
        where gi.gathering_id = past_recurring.id
        and gi.status = 'approved'
      loop
        if coalesce((select notify_planning from profiles where id = past_attendee.user_id), true) then
          perform public._send_push(past_attendee.user_id, '🔁 ' || past_recurring.title, 'It''s happening again — tap to rejoin.', jsonb_build_object('type', 'recurring_gathering', 'gathering_id', new_gathering_id));
        end if;
      end loop;
    end if;
  end loop;
end;
$function$;

-- host_remove_gathering_attendee
CREATE OR REPLACE FUNCTION public.host_remove_gathering_attendee(interest_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row gathering_interest%rowtype;
  v_host uuid; v_title text; v_scheduled timestamptz;
  v_promoted jsonb;
begin
  select * into v_row from gathering_interest where id = interest_id_param;
  if not found then raise exception 'Request not found'; end if;
  select host_id, title, scheduled_at into v_host, v_title, v_scheduled
    from gatherings where id = v_row.gathering_id for update;
  if v_host is distinct from auth.uid() then raise exception 'Only the host can do this'; end if;
  if v_scheduled < now() then raise exception 'This gathering has already happened'; end if;

  delete from gathering_interest where id = interest_id_param;

  if v_row.status in ('approved', 'pending') then
    v_promoted := _promote_from_waitlist(v_row.gathering_id);
  end if;

  if v_row.status <> 'approved'
     and coalesce((select notify_planning from profiles where id = v_row.user_id), true) then
    perform public._send_push(v_row.user_id, 'Update on your request', 'The host couldn''t approve your request to join "' || v_title || '".', jsonb_build_object('type', 'gathering_updated', 'gathering_id', v_row.gathering_id));
  end if;
  return jsonb_build_object('removed', true, 'promoted_user_id', v_promoted->>'user_id', 'promoted_status', v_promoted->>'status');
end;
$function$;

-- invite_more_to_occasion_group_plan
CREATE OR REPLACE FUNCTION public.invite_more_to_occasion_group_plan(plan_id_param uuid, invitee_ids_param uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_part_id uuid;
  v_plan record;
  v_can_invite boolean;
  v_invitee_id uuid;
  v_invited_count integer := 0;
  v_host_name text;
  v_wants_notif boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param;
  if v_plan is null then
    raise exception 'This plan does not exist.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'This plan is no longer open for new invites.';
  end if;

  select (v_plan.host_id = auth.uid()) or exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined' and is_organizer
  ) into v_can_invite;
  if not v_can_invite then
    raise exception 'Only the host or an organizer can invite more people.';
  end if;

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = v_plan.host_id;
      continue when is_blocked(auth.uid(), v_invitee_id);
      continue when v_plan.surprise_mode and v_plan.who_for_friend_id is not null and v_invitee_id = v_plan.who_for_friend_id;

      if not (
        exists (
          select 1 from friendships f
          where f.status = 'accepted'
          and ((f.user_a = auth.uid() and f.user_b = v_invitee_id) or (f.user_a = v_invitee_id and f.user_b = auth.uid()))
        )
        or exists (
          select 1 from matches m
          where (m.user_a = auth.uid() and m.user_b = v_invitee_id) or (m.user_a = v_invitee_id and m.user_b = auth.uid())
        )
      ) then
        continue;
      end if;

      begin
        insert into occasion_group_plan_participants (group_plan_id, user_id, status)
        values (plan_id_param, v_invitee_id, 'invited')
        returning id into v_part_id;
        v_invited_count := v_invited_count + 1;
        -- Item 125: recorded as INVITATION_SENT (this flow's own push below is unchanged)
        perform public._emit_event('INVITATION_SENT', 'occasion_group_plan_participant', v_part_id, auth.uid(), 'invite_more_to_occasion_group_plan',
      jsonb_build_object('participant_id', v_part_id, 'plan_id', plan_id_param, 'invitee_id', v_invitee_id), 'INVITATION_SENT:' || v_part_id);
      exception when unique_violation then
        continue;
      end;

      select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
      if v_wants_notif then
        perform public._send_push(v_invitee_id, '🗳️ You''re invited to plan together', coalesce(v_host_name, 'Someone you know') || ' wants your vote on ' || v_plan.title || '.', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', plan_id_param));
      end if;
    end loop;
  end if;

  return jsonb_build_object('invitedCount', v_invited_count);
end;
$function$;

-- invite_to_business_request
CREATE OR REPLACE FUNCTION public.invite_to_business_request(request_id_param uuid, invitee_ids_param uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_part_id uuid;
  v_request record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_companion_request_id uuid;
  v_expires_at timestamptz;
  v_invited_count integer := 0;
  v_initiator_name text;
  v_wants_notif boolean;
  v_excluded_friend_id uuid;
  v_primary_id uuid;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
begin
  select * into v_request from business_requests where id = request_id_param for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if not public._can_manage_business_request(v_request.id) then
    raise exception 'You do not have permission to invite for this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  if v_request.category is null then
    raise exception 'This request needs a category before you can invite someone.';
  end if;
  if invitee_ids_param is null or array_length(invitee_ids_param, 1) is null then
    raise exception 'Pick at least one person to invite.';
  end if;

  v_excluded_friend_id := public._surprise_excluded_friend_id_for_business_request(v_request.id);
  v_primary_id := coalesce(v_request.parent_request_id, v_request.id);
  select occasion_type, who_for_name into v_occ_type, v_occ_who
  from public._occasion_context_for_business_request(v_primary_id);

  select proposal_id into v_proposal_id
  from group_plan_participants
  where source_request_id = request_id_param and user_id = auth.uid();

  if v_proposal_id is null then
    v_expires_at := now() + interval '48 hours';
    insert into group_plan_proposals (initiator_id, category, date, time_window_start, time_window_end, radius_miles, expires_at)
    values (auth.uid(), v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end, v_request.radius_miles, v_expires_at)
    returning id into v_proposal_id;

    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
    values (v_proposal_id, auth.uid(), request_id_param, coalesce(v_request.party_size, 1), 'accepted', now());
  end if;

  select display_name into v_initiator_name from profiles where id = auth.uid();

  foreach v_invitee_id in array invitee_ids_param loop
    continue when v_invitee_id = auth.uid();
    continue when is_blocked(auth.uid(), v_invitee_id);
    -- Item 96: never re-invite the person this plan is a surprise for,
    -- even after it's become a real business_requests-backed plan.
    continue when v_excluded_friend_id is not null and v_invitee_id = v_excluded_friend_id;

    if not (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_invitee_id) or (f.user_a = v_invitee_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_invitee_id) or (m.user_a = v_invitee_id and m.user_b = auth.uid())
      )
    ) then
      continue;
    end if;

    insert into business_requests (
      requester_id, raw_text, category, date, time_window_start, time_window_end,
      latitude, longitude, radius_miles, expires_at
    ) values (
      v_invitee_id, v_request.raw_text, v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end,
      v_request.latitude, v_request.longitude, v_request.radius_miles, v_request.expires_at
    ) returning id into v_companion_request_id;

    begin
      insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status)
      values (v_proposal_id, v_invitee_id, v_companion_request_id, 1, 'invited')
      returning id into v_part_id;
      v_invited_count := v_invited_count + 1;
      -- Item 125: recorded as INVITATION_SENT (this flow's own push below is unchanged)
      perform public._emit_event('INVITATION_SENT', 'group_plan_participant', v_part_id, auth.uid(), 'invite_to_business_request',
      jsonb_build_object('participant_id', v_part_id, 'proposal_id', v_proposal_id, 'request_id', request_id_param, 'invitee_id', v_invitee_id), 'INVITATION_SENT:' || v_part_id);
    exception when unique_violation then
      continue;
    end;

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
    if v_wants_notif then
      if v_occ_type is not null then
        v_push_title := _occasion_emoji(v_occ_type) || ' You''re invited to help plan';
        v_push_body := coalesce(v_initiator_name, 'Someone you know') || ' invited you to help plan '
          || case when v_occ_who is not null then v_occ_who || '''s ' else 'their ' end
          || lower(_occasion_noun(v_occ_type)) || '.';
      else
        v_push_title := 'You''re invited to a plan';
        v_push_body := coalesce(v_initiator_name, 'Someone you know') || ' invited you to their ' || v_request.category || ' plan.';
      end if;

      perform public._send_push(v_invitee_id, v_push_title, v_push_body, jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id));
    end if;
  end loop;

  if v_invited_count = 0 then
    raise exception 'None of the people you picked could be invited -- they may no longer be connected.';
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'invitedCount', v_invited_count);
end;
$function$;

-- notify_aggregated_demand_threshold
CREATE OR REPLACE FUNCTION public.notify_aggregated_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;


  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner in the same
    -- category, mirroring get_aggregated_demand_for_partner()'s own
    -- "within the requester's own radius_miles of the business" rule.
    -- Distinct PEOPLE (not requests), excluding the row being inserted; the push fires only when this
    -- request brings the count to the shared privacy floor (demand_min_people()), so no business is ever
    -- told about a group smaller than that.
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as the group-intent trigger above --
    -- fires once when real nearby demand for this category first reaches
    -- 2, never again for the 3rd/4th/etc. request.
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform public._send_push(v_managing_profiles[i], 'Growing demand nearby', '5 or more people are now looking for ' || new.category || ' near ' || v_partner.name || '.', jsonb_build_object('type', 'aggregated_demand_growing', 'partner_id', v_partner.id, 'category', new.category));
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

-- notify_business_update
CREATE OR REPLACE FUNCTION public.notify_business_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  partner_name text;
  follower record;
  follower_wants_notif boolean;
begin
  select name into partner_name from brand_partners where id = new.partner_id;

  for follower in
    select user_id from business_followers where brand_partner_id = new.partner_id
  loop
    select coalesce(notify_business, true) into follower_wants_notif from profiles where id = follower.user_id;
    if not follower_wants_notif then
      continue;
    end if;

    perform public._send_push(follower.user_id, coalesce(partner_name, 'Business') || ': ' || new.title, coalesce(new.body, ''), jsonb_build_object('type', 'business_update', 'partner_id', new.partner_id));
  end loop;

  return new;
end;
$function$;

-- notify_community_area_demand_threshold
CREATE OR REPLACE FUNCTION public.notify_community_area_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_community record;
  v_prior_count integer;
  v_leader_ids uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;


  for v_community in
    select c.id, c.name, c.area_lat, c.area_lng
    from communities c
    where c.interest_tag = new.category
    and c.area_lat is not null
    and c.area_lng is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(c.area_lat)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(c.area_lng)) +
        sin(radians(c.area_lat)) * sin(radians(new.latitude))
      ))
    )) <= 15
  loop
    -- Real count of other open requests near this community's own Area
    -- point in the same category -- same "count everything real within
    -- reach" shape the business-side trigger already uses.
    select count(*) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_community.area_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_community.area_lng)) +
          sin(radians(v_community.area_lat)) * sin(radians(br.latitude))
        ))
      )) <= 15;

    -- Same crossing-point-only rule as the business/group-intent triggers --
    -- fires once when real nearby demand for this category first reaches 2,
    -- never again for the 3rd/4th/etc. request.
    if v_prior_count = 1 then
      select array_agg(user_id) into v_leader_ids
      from community_members
      where community_id = v_community.id and role in ('creator', 'leader');

      if v_leader_ids is not null then
        for i in 1 .. array_length(v_leader_ids, 1) loop
          continue when not coalesce((select notify_community from profiles where id = v_leader_ids[i]), true);
          perform public._send_push(v_leader_ids[i], 'Growing demand near your community', '2 or more people are now looking for ' || new.category || ' near ' || v_community.name || '.', jsonb_build_object('type', 'community_area_demand_growing', 'community_id', v_community.id, 'category', new.category));
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

-- notify_constitution_addition
CREATE OR REPLACE FUNCTION public.notify_constitution_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '📜 New entry added', adder_name || ' added something to your Constitution', jsonb_build_object('type', 'constitution_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_friend_request
CREATE OR REPLACE FUNCTION public.notify_friend_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requester_name text;
  v_recipient uuid;
  v_recipient_wants_notif boolean;
begin
  if new.status = 'pending' then
    v_recipient := case when new.user_a = new.requested_by then new.user_b else new.user_a end;
    select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = v_recipient;
    if not v_recipient_wants_notif then
      return new;
    end if;

    select display_name into v_requester_name from profiles where id = new.requested_by;

    perform public._send_push(v_recipient, 'New friend request', coalesce(v_requester_name, 'Someone') || ' wants to be friends on Nearby.', jsonb_build_object('type', 'friend_request'));
  end if;
  return new;
end;
$function$;

-- notify_friend_request_accepted
CREATE OR REPLACE FUNCTION public.notify_friend_request_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_accepter_name text;
  v_requester uuid;
  v_requester_wants_notif boolean;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    v_requester := new.requested_by;
    select coalesce(notify_social, true) into v_requester_wants_notif from profiles where id = v_requester;
    if not v_requester_wants_notif then
      return new;
    end if;

    select display_name into v_accepter_name from profiles where id = (case when new.requested_by = new.user_a then new.user_b else new.user_a end);

    perform public._send_push(v_requester, 'Friend request accepted', coalesce(v_accepter_name, 'Someone') || ' accepted your friend request.', jsonb_build_object('type', 'friend_accepted'));
  end if;
  return new;
end;
$function$;

-- notify_gathering_approved
CREATE OR REPLACE FUNCTION public.notify_gathering_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  v_host_id uuid;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform public._send_push(new.user_id, case when old.status = 'waitlisted' then 'A spot opened up!' else 'You''re approved!' end, case when old.status = 'waitlisted'
            then 'A spot opened up in "' || gathering_title || '" and you''re in! Start chatting!'
            else 'The host of "' || gathering_title || '" approved your request. Start chatting!' end, jsonb_build_object('type', 'gathering_approved', 'match_id', new.match_id));
    end if;
  elsif new.status = 'pending' and old.status = 'waitlisted' then
    -- Waitlist promotion on an approval-required gathering: the person moves to the SAME pending state a normal request
    -- has (20270120). Tell the host there is a request to review and tell the person a spot opened up.
    select title, host_id into gathering_title, v_host_id from gatherings where id = new.gathering_id;
    if coalesce((select notify_planning from profiles where id = v_host_id), true)
       and coalesce((select host_notifications from gatherings where id = new.gathering_id), true) then
      perform public._send_push(v_host_id, 'A spot opened up', 'Next on the waitlist for "' || gathering_title || '" is waiting for your approval.', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id));
    end if;
    if coalesce((select notify_planning from profiles where id = new.user_id), true) then
      perform public._send_push(new.user_id, 'A spot opened up', 'A spot opened up in "' || gathering_title || '" — the host will review your request.', jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.gathering_id));
    end if;
  elsif new.status = 'waitlisted' and old.status = 'pending' then

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform public._send_push(new.user_id, 'Added to the waitlist', '"' || gathering_title || '" is full, but you''re on the waitlist — we''ll let you know if a spot opens.', jsonb_build_object('type', 'gathering_waitlisted', 'gathering_id', new.gathering_id));
    end if;
  end if;
  return new;
end;
$function$;

-- notify_gathering_cancelled
CREATE OR REPLACE FUNCTION public.notify_gathering_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient record;
begin

  for recipient in
    select user_id from gathering_interest where gathering_id = old.id and status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = old.id
       and old.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = old.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = old.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      perform public._send_push(recipient.user_id, 'A gathering was cancelled', '"' || old.title || '" has been cancelled by the host.', jsonb_build_object('type', 'gathering_cancelled'));
    end if;
  end loop;
  return old;
end;
$function$;

-- notify_gathering_interest
CREATE OR REPLACE FUNCTION public.notify_gathering_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_host_id uuid;
  gathering_title text;
  interested_user_name text;
  host_wants_notif boolean;
begin

  select host_id, title into gathering_host_id, gathering_title from gatherings where id = new.gathering_id;
  select display_name into interested_user_name from profiles where id = new.user_id;
  select coalesce(notify_planning, true) into host_wants_notif from profiles where id = gathering_host_id;
  -- Item 73: the host can mute join/request pushes for THIS gathering.
  if not coalesce((select host_notifications from gatherings where id = new.gathering_id), true) then
    host_wants_notif := false;
  end if;

  if host_wants_notif then
    perform public._send_push(gathering_host_id, case new.status
                     when 'approved' then 'Someone joined your gathering'
                     when 'waitlisted' then 'Someone joined your waitlist'
                     else 'New request to join your gathering' end, interested_user_name || case new.status
                     when 'approved' then ' joined "'
                     when 'waitlisted' then ' joined the waitlist for "'
                     else ' asked to join "' end || gathering_title || '"', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id));
  end if;
  return new;
end;
$function$;

-- notify_gathering_interest_threshold
CREATE OR REPLACE FUNCTION public.notify_gathering_interest_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gathering record;
  v_interest_count integer;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_scheduled_local timestamp;
  v_when_phrase text;
begin
  select * into v_gathering from gatherings where id = new.gathering_id;
  if v_gathering.id is null
     or v_gathering.visibility <> 'everyone' or coalesce(v_gathering.is_public, false) is not true
     or v_gathering.discoverable is not true
     or v_gathering.interest_tag is null
     or v_gathering.precise_lat is null or v_gathering.precise_lng is null
     or v_gathering.scheduled_at <= now() then
    return new;
  end if;

  -- Fire exactly at the real 3rd real interest row -- never again for the
  -- 4th/5th/etc, matching notify_group_intent_threshold()'s own "fire once"
  -- precedent so this can't nag the same matched user repeatedly for one
  -- gathering as more people join.
  select count(*) into v_interest_count from gathering_interest where gathering_id = new.gathering_id;
  if v_interest_count <> 3 then
    return new;
  end if;


  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_things_to_do_frequency, p.notify_things_to_do_max_distance_miles,
           p.notify_things_to_do_time_pref
    from profiles p
    join push_target_areas pr on pr.user_id = p.id
    where p.id <> v_gathering.host_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and p.interests @> array[v_gathering.interest_tag]
      and (p.notify_things_to_do_categories is null or v_gathering.interest_tag = any(p.notify_things_to_do_categories))
      and not exists (
        select 1 from gathering_interest gi where gi.gathering_id = new.gathering_id and gi.user_id = p.id
      )
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(v_gathering.precise_lat)) * cos(radians(v_gathering.precise_lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(v_gathering.precise_lat))
    )));
    if v_candidate.notify_things_to_do_max_distance_miles is not null
       and v_distance_miles > v_candidate.notify_things_to_do_max_distance_miles then
      continue;
    end if;

    v_scheduled_local := v_gathering.scheduled_at at time zone v_candidate.tz;
    if v_candidate.notify_things_to_do_time_pref = 'evenings_weekends'
       and extract(dow from v_scheduled_local) not in (0, 6)
       and extract(hour from v_scheduled_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'gathering'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_things_to_do_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20 -- 'as_they_happen' -- still a hard safety ceiling, not literally unlimited
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    v_when_phrase := case
      when v_scheduled_local::date = v_today_in_tz and extract(hour from v_scheduled_local) >= 17 then 'tonight'
      when v_scheduled_local::date = v_today_in_tz then 'today'
      when v_scheduled_local::date = v_today_in_tz + 1 then 'tomorrow'
      when extract(dow from v_scheduled_local) in (0, 6) and v_scheduled_local::date <= v_today_in_tz + 7 then 'this weekend'
      else to_char(v_scheduled_local, 'FMDay')
    end;

    perform public._send_push(v_candidate.id, '🎉 People nearby are planning this', v_interest_count || ' people have signed up for "' || v_gathering.title || '", happening ' || v_when_phrase || ' — and you like ' || v_gathering.interest_tag || '.', jsonb_build_object('type', 'recommended_gathering', 'gathering_id', v_gathering.id));
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'gathering', v_gathering.id);
  end loop;
  return new;
end;
$function$;

-- notify_gathering_updated
CREATE OR REPLACE FUNCTION public.notify_gathering_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient record;
  time_changed boolean;
begin
  time_changed := old.scheduled_at is distinct from new.scheduled_at;

  if not time_changed and old.title = new.title and old.area is not distinct from new.area then
    return new;
  end if;


  for recipient in
    select gi.user_id from gathering_interest gi
     where gi.gathering_id = new.id and gi.status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = new.id
       and new.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = new.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = new.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      perform public._send_push(recipient.user_id, 'Gathering Updated', case
            when time_changed then '"' || new.title || '" changed to a new time — tap to see details.'
            else '"' || new.title || '" was updated — tap to see details.'
          end, jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.id));
    end if;
  end loop;

  return new;
end;
$function$;

-- notify_group_intent_threshold
CREATE OR REPLACE FUNCTION public.notify_group_intent_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_connected_user record;
  v_prior_count integer;
  v_wants_notif boolean;
begin
  if new.status <> 'open' or new.category is null then
    return new;
  end if;

  -- An opted-out requester's own new row should never count toward
  -- crossing anyone else's group-intent threshold either -- mirrors the
  -- read RPC's own filter exactly, not a separate rule.
  if not exists (
    select 1 from profiles where id = new.requester_id and intent_visibility = 'friends_and_matches'
  ) then
    return new;
  end if;


  for v_connected_user in
    select case when f.user_a = new.requester_id then f.user_b else f.user_a end as user_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.requester_id or f.user_b = new.requester_id)
    union
    select case when m.user_a = new.requester_id then m.user_b else m.user_a end as user_id
    from matches m
    where m.user_a = new.requester_id or m.user_b = new.requester_id
  loop
    -- How many of THIS connected user's own connections already have a
    -- real open request in this category, not counting the new row?
    -- Mirrors get_my_group_intent_signals()'s own connected-set + real
    -- open/expiry/category/intent_visibility filters exactly.
    select count(distinct br.requester_id) into v_prior_count
    from business_requests br
    join profiles p2 on p2.id = br.requester_id
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.requester_id <> v_connected_user.user_id
      and p2.intent_visibility = 'friends_and_matches'
      and (
        exists (
          select 1 from friendships f2
          where f2.status = 'accepted'
          and ((f2.user_a = v_connected_user.user_id and f2.user_b = br.requester_id)
            or (f2.user_a = br.requester_id and f2.user_b = v_connected_user.user_id))
        )
        or exists (
          select 1 from matches m2
          where (m2.user_a = v_connected_user.user_id and m2.user_b = br.requester_id)
            or (m2.user_a = br.requester_id and m2.user_b = v_connected_user.user_id)
        )
      );

    -- Fire exactly once, at the real 1 -> 2 crossing -- never again for
    -- the 3rd/4th/etc. request in the same category, so this can't nag.
    if v_prior_count = 1 then
      select coalesce(notify_discovery, true) into v_wants_notif from profiles where id = v_connected_user.user_id;
      if v_wants_notif then
        perform public._send_push(v_connected_user.user_id, 'A few people you know want this too', '2 or more people you''re connected to are looking for ' || new.category || ' right now.', jsonb_build_object('type', 'group_intent_signal', 'category', new.category));
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

-- notify_interested_friend_joined
CREATE OR REPLACE FUNCTION public.notify_interested_friend_joined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
  joiner_name text;
  r record;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return new;
  end if;

  select id, host_id, title, scheduled_at into g from gatherings where id = new.gathering_id;
  if g.id is null or g.scheduled_at <= now() or g.host_id = new.user_id then
    return new;
  end if;

  select display_name into joiner_name from profiles where id = new.user_id;

  for r in
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = new.gathering_id
       and gd.user_id <> new.user_id
       -- accepted friends only (not matches, not strangers)
       and exists (select 1 from friendships f where f.status = 'accepted'
                    and ((f.user_a = gd.user_id and f.user_b = new.user_id) or (f.user_a = new.user_id and f.user_b = gd.user_id)))
       and not exists (select 1 from blocks b
                        where (b.blocker_id = gd.user_id and b.blocked_id = new.user_id)
                           or (b.blocker_id = new.user_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = g.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = g.host_id))
  loop
    if not coalesce((select notify_planning from profiles where id = r.user_id), true) then
      continue;
    end if;
    insert into gathering_interested_friend_pushes (gathering_id, user_id) values (new.gathering_id, r.user_id)
      on conflict do nothing;
    if not found then
      continue;
    end if;
    perform public._send_push(r.user_id, 'A friend is going', coalesce(joiner_name, 'A friend') || ' is going to "' || g.title || '". Want to join?', jsonb_build_object('type', 'friend_joined_gathering', 'gathering_id', g.id));
  end loop;
  return new;
end;
$function$;

-- notify_matching_business_availability
CREATE OR REPLACE FUNCTION public.notify_matching_business_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner record;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_effective_radius double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_starts_local timestamp;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select id, name, latitude, longitude, subcategory, categories
    into v_partner
    from brand_partners bp
    where bp.id = new.partner_id;
  if v_partner.latitude is null or v_partner.longitude is null then
    return new;
  end if;


  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_nearby_opportunities_frequency, p.notify_nearby_opportunities_max_distance_miles,
           p.notify_nearby_opportunities_time_pref,
           coalesce(
             case when new.category is not null and p.interests @> array[new.category] then new.category end,
             case when v_partner.subcategory is not null and p.interests @> array[v_partner.subcategory] then v_partner.subcategory end,
             (select c from unnest(coalesce(v_partner.categories, array[]::text[])) c where p.interests @> array[c] limit 1)
           ) as matched_tag
    from profiles p
    join push_target_areas pr on pr.user_id = p.id
    where coalesce(p.managed_partner_id, '00000000-0000-0000-0000-000000000000'::uuid) <> new.partner_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and (
        (new.category is not null and p.interests @> array[new.category])
        or (v_partner.subcategory is not null and p.interests @> array[v_partner.subcategory])
        or (v_partner.categories is not null and p.interests && v_partner.categories)
      )
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(v_partner.latitude)) * cos(radians(v_partner.longitude) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(v_partner.latitude))
    )));
    v_effective_radius := coalesce(new.radius_miles, 15);
    if v_candidate.notify_nearby_opportunities_max_distance_miles is not null then
      v_effective_radius := least(v_effective_radius, v_candidate.notify_nearby_opportunities_max_distance_miles);
    end if;
    if v_distance_miles > v_effective_radius then
      continue;
    end if;

    v_starts_local := new.starts_at at time zone v_candidate.tz;
    if v_candidate.notify_nearby_opportunities_time_pref = 'evenings_weekends'
       and extract(dow from v_starts_local) not in (0, 6)
       and extract(hour from v_starts_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'business_availability'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_nearby_opportunities_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    perform public._send_push(v_candidate.id, '🌟 This matches you', coalesce(v_partner.name, 'A nearby business') || '''s "' || new.title || '" is nearby, and you like ' || coalesce(v_candidate.matched_tag, 'this kind of thing') || '.', jsonb_build_object('type', 'recommended_business_availability', 'availability_id', new.id, 'partner_id', new.partner_id));
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'business_availability', new.id);
  end loop;
  return new;
end;
$function$;

-- notify_memory_addition
CREATE OR REPLACE FUNCTION public.notify_memory_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '💫 New memory added', adder_name || ' added something to your Memory Vault', jsonb_build_object('type', 'memory_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_new_message
CREATE OR REPLACE FUNCTION public.notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  sender_name text;
  notif_body text;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;
  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into sender_name from profiles where id = new.sender_id;

  notif_body := case
    when new.audio_url is not null then 'Sent a voice message'
    when new.media_url is not null then 'Sent a photo'
    when new.gif_url is not null then 'Sent a GIF'
    when new.body is not null and new.body != '' then left(new.body, 100)
    else 'Sent a message'
  end;

  if recipient_wants_notif then
    perform public._send_push(recipient, coalesce(sender_name, 'New message'), notif_body, jsonb_build_object('type', 'message', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_new_story
CREATE OR REPLACE FUNCTION public.notify_new_story()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  poster_name text;
  recipient record;
  already_posted_today boolean;
  poster_timezone text;
  poster_today_start timestamptz;
begin
  select coalesce(timezone, 'UTC') into poster_timezone from profiles where id = new.user_id;

  -- "Today" is now computed in the poster's own timezone, not the
  -- server's UTC default — same pattern already fixed for the daily
  -- AI/browse limits and birthday reminders.
  begin
    poster_today_start := date_trunc('day', now() at time zone poster_timezone) at time zone poster_timezone;
  exception when others then
    poster_today_start := date_trunc('day', now());
  end;

  select exists(
    select 1 from stories
    where user_id = new.user_id
    and id != new.id
    and created_at > poster_today_start
  ) into already_posted_today;

  if already_posted_today then
    return new;
  end if;

  select display_name into poster_name from profiles where id = new.user_id;

  for recipient in
    select case when m.user_a = new.user_id then m.user_b else m.user_a end as recipient_id
    from matches m
    where m.user_a = new.user_id or m.user_b = new.user_id
    union
    select case when f.user_a = new.user_id then f.user_b else f.user_a end as recipient_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.user_id or f.user_b = new.user_id)
  loop
    if coalesce((select notify_social from profiles where id = recipient.recipient_id), true) then
      perform public._send_push(recipient.recipient_id, 'New Story', coalesce(poster_name, 'Someone') || ' posted a new story.', jsonb_build_object('type', 'new_story', 'story_user_id', new.user_id));
    end if;
  end loop;
  return new;
end;
$function$;

-- notify_occasion_demand_threshold
CREATE OR REPLACE FUNCTION public.notify_occasion_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.occasion is null or new.latitude is null or new.longitude is null then
    return new;
  end if;


  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner sharing the
    -- same occasion, regardless of category -- mirroring notify_
    -- aggregated_demand_threshold()'s own "within the requester's own
    -- radius_miles of the business" rule, just cross-category.
    -- Distinct PEOPLE (not requests), excluding the row being inserted; the push fires only when this
    -- request brings the count to the shared privacy floor (demand_min_people()), so no business is ever
    -- told about a group smaller than that.
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.occasion = new.occasion
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as its category sibling -- fires once
    -- when real nearby demand for this occasion first reaches 2, never
    -- again for the 3rd/4th/etc. request.
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform public._send_push(v_managing_profiles[i], _occasion_emoji(new.occasion) || ' Growing ' || _occasion_noun(new.occasion) || ' demand nearby', '5 or more groups nearby are now planning a ' || lower(_occasion_noun(new.occasion)) || ' -- near ' || v_partner.name || '.', jsonb_build_object('type', 'occasion_demand_growing', 'partner_id', v_partner.id, 'occasion_type', new.occasion));
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

-- notify_playlist_addition
CREATE OR REPLACE FUNCTION public.notify_playlist_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '🎵 New song added', adder_name || ' added "' || new.song_title || '" to your shared playlist', jsonb_build_object('type', 'playlist_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_screenshot_taken
CREATE OR REPLACE FUNCTION public.notify_screenshot_taken(match_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_taker_id uuid := auth.uid();
  v_recipient uuid;
  v_taker_name text;
  v_recipient_wants_notif boolean;
begin
  select case when m.user_a = v_taker_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_taker_id or m.user_b = v_taker_id);

  if v_recipient is null then
    return;
  end if;

  select coalesce(notify_dating, true) into v_recipient_wants_notif from profiles where id = v_recipient;
  if not v_recipient_wants_notif then
    return;
  end if;

  select display_name into v_taker_name from profiles where id = v_taker_id;

  perform public._send_push(v_recipient, 'Screenshot taken', coalesce(v_taker_name, 'Someone') || ' took a screenshot of your conversation.', jsonb_build_object('type', 'screenshot', 'match_id', match_id_param));
end;
$function$;

-- notify_shared_decision_addition
CREATE OR REPLACE FUNCTION public.notify_shared_decision_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '🧭 New thought shared', adder_name || ' shared a thought in your Big Picture conversation', jsonb_build_object('type', 'shared_decision_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_sighting_crossed_paths
CREATE OR REPLACE FUNCTION public.notify_sighting_crossed_paths()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  name_a text;
  name_b text;
  a_wants_notif boolean;
  b_wants_notif boolean;
begin
  select display_name into name_a from profiles where id = new.user_a;
  select display_name into name_b from profiles where id = new.user_b;

  select coalesce(notify_proximity, true) into a_wants_notif from profiles where id = new.user_a;
  select coalesce(notify_proximity, true) into b_wants_notif from profiles where id = new.user_b;

  if a_wants_notif then
    perform public._send_push(new.user_a, 'You crossed paths! 👋', 'You and ' || coalesce(name_b, 'someone nearby') || ' were near each other just now.', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_b));
  end if;

  if b_wants_notif then
    perform public._send_push(new.user_b, 'You crossed paths! 👋', 'You and ' || coalesce(name_a, 'someone nearby') || ' were near each other just now.', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_a));
  end if;

  return new;
end;
$function$;

-- notify_stress_test_addition
CREATE OR REPLACE FUNCTION public.notify_stress_test_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '🧪 New "What If" thought', adder_name || ' shared a thought on one of your scenarios', jsonb_build_object('type', 'stress_test_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_super_notice
CREATE OR REPLACE FUNCTION public.notify_super_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient_wants_notif boolean;
  sender_name text;
begin
  if new.is_super = true then
    select notify_dating into recipient_wants_notif from profiles where id = new.to_user;
    select display_name into sender_name from profiles where id = new.from_user;
    if recipient_wants_notif then
      perform public._send_push(new.to_user, coalesce(sender_name, 'Someone') || ' waved at you! 👋', 'Open the app to see their profile.', jsonb_build_object('type', 'wave'));
    end if;
  end if;
  return new;
end;
$function$;

-- notify_timeline_addition
CREATE OR REPLACE FUNCTION public.notify_timeline_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '🗓️ New timeline thought', adder_name || ' added a thought to your Timeline', jsonb_build_object('type', 'timeline_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_trip_idea_addition
CREATE OR REPLACE FUNCTION public.notify_trip_idea_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
begin

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform public._send_push(recipient, '🧳 New trip idea', adder_name || ' added an idea to your trip plan', jsonb_build_object('type', 'trip_idea_addition', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;

-- notify_video_call_started
CREATE OR REPLACE FUNCTION public.notify_video_call_started(match_id_param uuid, call_kind text DEFAULT 'video'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_id uuid := auth.uid();
  v_recipient uuid;
  v_caller_name text;
  v_recipient_wants_notif boolean;
begin
  select case when m.user_a = v_caller_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_caller_id or m.user_b = v_caller_id);

  if v_recipient is null then
    return;
  end if;

  select coalesce(notify_dating, true) into v_recipient_wants_notif from profiles where id = v_recipient;
  if not v_recipient_wants_notif then
    return;
  end if;

  select display_name into v_caller_name from profiles where id = v_caller_id;

  perform public._send_push(v_recipient, coalesce(v_caller_name, 'Someone') || (case when call_kind = 'voice' then ' started a voice call' else ' started a video call' end), 'Tap to join.', jsonb_build_object('type', 'video_call', 'match_id', match_id_param, 'call_kind', call_kind));
end;
$function$;

-- post_business_availability
CREATE OR REPLACE FUNCTION public.post_business_availability(category_param text, title_param text, description_param text, offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone, ends_at_param timestamp with time zone, radius_miles_param double precision DEFAULT 15, bundle_occasion_param text DEFAULT NULL::text, bundle_components_param text[] DEFAULT NULL::text[], discount_pct_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_matched_people uuid[] := array[]::uuid[];
  v_req record;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_bundle_components text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;
  if title_param is null or length(trim(title_param)) = 0 then
    raise exception 'Give this availability a real title.';
  end if;
  if ends_at_param <= starts_at_param then
    raise exception 'End time must be after the start time.';
  end if;

  if bundle_occasion_param is not null and bundle_occasion_param not in (
    'date_night', 'anniversary', 'birthday', 'celebration', 'family_gathering'
  ) then
    raise exception 'Invalid bundle occasion';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;
  if _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param) is not null then
    raise exception '%', _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param);
  end if;

  v_bundle_components := coalesce(bundle_components_param, '{}');
  if not (v_bundle_components <@ array[
    'dinner', 'something_to_do', 'finish_the_night',
    'something_fun', 'sweet_treat',
    'food', 'family_fun'
  ]::text[]) then
    raise exception 'Invalid bundle component';
  end if;
  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;
  -- 20270227: each part must belong to this occasion's bundle (Family Fun only with Family Gathering). A validation error.
  if public._bundle_component_problem(bundle_occasion_param, v_bundle_components) is not null then
    raise exception '%', public._bundle_component_problem(bundle_occasion_param, v_bundle_components);
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles,
    bundle_occasion, bundle_components, discount_pct
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15),
    bundle_occasion_param, v_bundle_components, discount_pct_param
  ) returning id into v_availability_id;

  for v_req in
    select br.*
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and (capacity_param is null or br.party_size is null or capacity_param >= br.party_size)
    and (category_param is null or br.category is null or br.category = category_param)
    and (
      br.date is null
      or br.date between starts_at_param::date and ends_at_param::date
    )
    and (
      br.date is null or br.time_window_start is null or br.time_window_end is null
      or (br.date + br.time_window_start, br.date + br.time_window_end) overlaps (starts_at_param, ends_at_param)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= least(br.radius_miles, coalesce(radius_miles_param, 15))
    order by br.created_at desc
    limit 10
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (v_req.id, v_partner_id, offer_type_param, coalesce(description_param, title_param), price_param, v_availability_id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;
      if not (v_req.requester_id = any(v_matched_people)) then v_matched_people := array_append(v_matched_people, v_req.requester_id); end if;

      if coalesce((select notify_business from profiles where id = v_req.requester_id), true) then
        select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_req.id);

        if v_occ_type is not null then
          v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
          v_push_body := trim(title_param) || ' just became available for your ' || lower(_occasion_noun(v_occ_type)) || ' request'
            || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
        else
          v_push_title := 'New offer for your request!';
          v_push_body := trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"';
        end if;

        perform public._send_push(v_req.requester_id, v_push_title, v_push_body, jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id));
      end if;
    end if;
  end loop;

  -- Privacy floor: how many requests matched is a demand figure about unconnected people, so it is returned only when
  -- >= demand_min_people() DISTINCT people are behind it (else null). The offers themselves are sent regardless.
  return jsonb_build_object(
    'availabilityId', v_availability_id,
    'matchedCount', case when coalesce(array_length(v_matched_people, 1), 0) >= public.demand_min_people() then v_matched_count end
  );
end;
$function$;

-- propose_date
CREATE OR REPLACE FUNCTION public.propose_date(match_id_param uuid, plan_text_param text, availability_id_param uuid DEFAULT NULL::uuid, category_param text DEFAULT NULL::text, attributes_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_match record;
  v_other_id uuid;
  v_proposal_id uuid;
  v_availability_still_live boolean;
  v_proposer_name text;
  v_attributes text[];
begin
  if plan_text_param is null or length(trim(plan_text_param)) = 0 then
    raise exception 'Tell your match what you have in mind.';
  end if;

  select * into v_match from matches where id = match_id_param;
  if v_match is null then
    raise exception 'Match not found.';
  end if;
  if auth.uid() <> v_match.user_a and auth.uid() <> v_match.user_b then
    raise exception 'You are not part of this match.';
  end if;
  v_other_id := case when v_match.user_a = auth.uid() then v_match.user_b else v_match.user_a end;
  if is_blocked(auth.uid(), v_other_id) then
    raise exception 'This match is no longer available.';
  end if;

  if exists (select 1 from date_proposals where match_id = match_id_param and status = 'proposed') then
    raise exception 'There is already a plan awaiting a response for this match.';
  end if;

  -- A basic, honest existence/liveness check -- not the full feasibility
  -- re-check (party size, exact distance) create_business_request_for_
  -- match's own _match_request_to_availability() call does later at
  -- actual claim time. This just stops a proposer from inviting someone
  -- to a place that's already gone by the time they hit "Propose Plan."
  if availability_id_param is not null then
    select exists (
      select 1 from business_availability
      where id = availability_id_param and status = 'active' and ends_at > now()
    ) into v_availability_still_live;
    if not v_availability_still_live then
      raise exception 'That place is no longer available -- try finding something else nearby.';
    end if;
  end if;

  -- What kind of date the proposer picked (romantic, quiet, cozy...): only what they tapped, distinct; the column CHECK refuses
  -- anything outside the date vibes. Never filled for them.
  select coalesce(array_agg(distinct a), '{}') into v_attributes from unnest(coalesce(attributes_param, '{}')) a where a is not null and length(trim(a)) > 0;

  insert into date_proposals (match_id, proposed_by, plan_text, availability_id, category, attributes)
  values (match_id_param, auth.uid(), trim(plan_text_param), availability_id_param, category_param, v_attributes)
  returning id into v_proposal_id;

  select display_name into v_proposer_name from profiles where id = auth.uid();
  if coalesce((select notify_planning from profiles where id = v_other_id), true) then
    perform public._send_push(v_other_id, 'A plan for you two 💌', coalesce(v_proposer_name, 'Your match') || ' proposed a plan: "' || left(trim(plan_text_param), 60) || '"', jsonb_build_object('type', 'date_proposal', 'proposal_id', v_proposal_id, 'match_id', match_id_param));
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'status', 'proposed');
end;
$function$;

-- propose_group_plan
CREATE OR REPLACE FUNCTION public.propose_group_plan(source_request_id_param uuid, invitee_source_request_ids_param uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_part_id uuid;
  v_source record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_invitee_request record;
  v_min_budget integer;
  v_max_budget integer;
  v_expires_at timestamptz;
  v_participant_count integer;
  v_initiator_name text;
  v_wants_notif boolean;
begin
  select * into v_source from business_requests where id = source_request_id_param and requester_id = auth.uid() for update;
  if v_source is null then
    raise exception 'You do not own this request.';
  end if;
  if v_source.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  if v_source.category is null then
    raise exception 'A group plan needs a real category.';
  end if;
  if invitee_source_request_ids_param is null or array_length(invitee_source_request_ids_param, 1) is null then
    raise exception 'Invite at least one connected person to form a group plan.';
  end if;

  v_min_budget := v_source.budget_max;
  v_max_budget := v_source.budget_max;
  v_expires_at := now() + interval '48 hours';

  insert into group_plan_proposals (initiator_id, category, date, time_window_start, time_window_end, radius_miles, expires_at)
  values (auth.uid(), v_source.category, v_source.date, v_source.time_window_start, v_source.time_window_end, v_source.radius_miles, v_expires_at)
  returning id into v_proposal_id;

  -- Rule 3: the initiator is a real participant like everyone else, not a
  -- special row -- they just consent by proposing.
  begin
    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
    values (v_proposal_id, auth.uid(), source_request_id_param, coalesce(v_source.party_size, 1), 'accepted', now());
  exception when unique_violation then
    raise exception 'This request is already part of another pending group plan.';
  end;

  select display_name into v_initiator_name from profiles where id = auth.uid();

  foreach v_invitee_id in array invitee_source_request_ids_param loop
    select br.*, p.display_name into v_invitee_request
    from business_requests br
    join profiles p on p.id = br.requester_id
    where br.id = v_invitee_id
    and br.status = 'open'
    and br.requester_id <> auth.uid()
    and p.intent_visibility = 'friends_and_matches'
    and not is_blocked(auth.uid(), br.requester_id)
    and (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = br.requester_id) or (f.user_a = br.requester_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = br.requester_id) or (m.user_a = br.requester_id and m.user_b = auth.uid())
      )
    )
    for update of br;

    if v_invitee_request is null or v_invitee_request.category is distinct from v_source.category then
      -- Not a real, still-open, genuinely-connected, unblocked, same-category
      -- request -- silently skipped rather than failing the whole
      -- proposal. The client only ever sources this list from
      -- get_connected_open_business_requests scoped to this same
      -- category (and, as of this fix, already block-filtered), so a
      -- mismatch here means the world changed between fetch and submit
      -- (e.g. it just got fulfilled, or a block was created), not an
      -- abuse attempt worth surfacing as a hard error.
      v_invitee_request := null;
      continue;
    end if;

    begin
      insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status)
      values (v_proposal_id, v_invitee_request.requester_id, v_invitee_id, coalesce(v_invitee_request.party_size, 1), 'invited')
      on conflict (proposal_id, user_id) do nothing
      returning id into v_part_id;
      -- Item 125: recorded as INVITATION_SENT
      if v_part_id is not null then
        perform public._emit_event('INVITATION_SENT', 'group_plan_participant', v_part_id, auth.uid(), 'propose_group_plan',
      jsonb_build_object('participant_id', v_part_id, 'proposal_id', v_proposal_id, 'request_id', v_invitee_id, 'invitee_id', v_invitee_request.requester_id), 'INVITATION_SENT:' || v_part_id);
      end if;
    exception when unique_violation then
      -- Finding C3: this source_request_id is already an active
      -- (invited/accepted) participant in a different, concurrently-
      -- pending proposal -- same silent-skip treatment as any other
      -- invitee whose request changed between fetch and submit, not a
      -- hard error for the whole proposal.
      v_invitee_request := null;
      continue;
    end;

    if v_invitee_request.budget_max is not null then
      v_min_budget := least(coalesce(v_min_budget, v_invitee_request.budget_max), v_invitee_request.budget_max);
      v_max_budget := greatest(coalesce(v_max_budget, v_invitee_request.budget_max), v_invitee_request.budget_max);
    end if;

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_request.requester_id;
    if v_wants_notif then
      perform public._send_push(v_invitee_request.requester_id, 'Make this a group plan?', coalesce(v_initiator_name, 'Someone you know') || ' wants to turn your ' || v_source.category || ' request into a shared group plan.', jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id));
    end if;

    v_invitee_request := null;
  end loop;

  update group_plan_proposals set proposed_budget_min = v_min_budget, proposed_budget_max = v_max_budget where id = v_proposal_id;

  select count(*) into v_participant_count from group_plan_participants where proposal_id = v_proposal_id;
  if v_participant_count < 2 then
    raise exception 'None of the people you invited could be added -- they may no longer be connected, or their request may have changed.';
  end if;

  return v_proposal_id;
end;
$function$;

-- record_friend_discovery_swipe
CREATE OR REPLACE FUNCTION public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 RETURNS TABLE(is_mutual_match boolean, match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  v_friendship_id uuid;
  v_match_id uuid;
  v_reverse_like_exists boolean;
  v_i_opted_in boolean;
  v_they_opted_in boolean;
  v_already_connected boolean;
  v_my_name text;
  v_recipient_wants_notif boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_me = target_user_id then
    raise exception 'You cannot swipe on yourself';
  end if;
  if direction_param not in ('like', 'pass') then
    raise exception 'Invalid direction';
  end if;

  perform id from profiles where id in (least(v_me, target_user_id), greatest(v_me, target_user_id)) order by id for update;

  select open_to_friend_discovery into v_i_opted_in from profiles where id = v_me;
  select open_to_friend_discovery into v_they_opted_in from profiles where id = target_user_id;
  if not coalesce(v_i_opted_in, false) or not coalesce(v_they_opted_in, false) then
    return query select false, null::uuid;
    return;
  end if;

  if is_blocked(v_me, target_user_id) then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friendships f
    where (f.user_a = v_me and f.user_b = target_user_id) or (f.user_a = target_user_id and f.user_b = v_me)
  ) or exists (
    select 1 from matches m
    where (m.user_a = v_me and m.user_b = target_user_id) or (m.user_a = target_user_id and m.user_b = v_me)
  ) into v_already_connected;

  if v_already_connected then
    return query select false, null::uuid;
    return;
  end if;

  insert into friend_discovery_swipes (from_user, to_user, direction)
  values (v_me, target_user_id, direction_param)
  on conflict (from_user, to_user) do nothing;

  if direction_param = 'pass' then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friend_discovery_swipes
    where from_user = target_user_id and to_user = v_me and direction = 'like'
  ) into v_reverse_like_exists;

  if not v_reverse_like_exists then
    return query select false, null::uuid;
    return;
  end if;

  v_user_a := least(v_me, target_user_id);
  v_user_b := greatest(v_me, target_user_id);

  perform set_config('app.trusted_update', 'true', true);

  insert into friendships (user_a, user_b, status, requested_by)
  values (v_user_a, v_user_b, 'accepted', v_me)
  on conflict (user_a, user_b) do update set status = 'accepted'
  where friendships.status <> 'accepted'
  returning id into v_friendship_id;

  if v_friendship_id is null then
    select id into v_friendship_id from friendships where user_a = v_user_a and user_b = v_user_b;
  end if;

  insert into matches (user_a, user_b, source_friendship_id)
  values (v_user_a, v_user_b, v_friendship_id)
  on conflict (user_a, user_b) do update
    set source_friendship_id = coalesce(matches.source_friendship_id, excluded.source_friendship_id)
  returning id into v_match_id;

  perform set_config('app.trusted_update', 'false', true);

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = target_user_id;
  if v_recipient_wants_notif then
    select display_name into v_my_name from profiles where id = v_me;
    perform public._send_push(target_user_id, 'New friend!', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id));
  end if;

  return query select true, v_match_id;
end;
$function$;

-- remove_group_plan_participant
CREATE OR REPLACE FUNCTION public.remove_group_plan_participant(proposal_id_param uuid, target_user_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_participant record;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can remove someone.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan can no longer be edited -- it has already been confirmed, cancelled, or expired.';
  end if;
  if target_user_id_param = auth.uid() then
    raise exception 'You can''t remove yourself -- cancel the group plan instead.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = target_user_id_param for update;
  if v_participant is null then
    raise exception 'That person is not part of this group plan.';
  end if;
  if v_participant.status = 'left' then
    raise exception 'That person has already left this group plan.';
  end if;

  update group_plan_participants
  set status = 'left', responded_at = coalesce(responded_at, now())
  where id = v_participant.id;

  if coalesce((select notify_planning from profiles where id = target_user_id_param), true) then
    perform public._send_push(target_user_id_param, 'You were removed from a group plan', 'You''re no longer part of the ' || v_proposal.category || ' group plan.', jsonb_build_object('type', 'group_plan_removed', 'proposal_id', proposal_id_param));
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

-- request_more_business_partner_info
CREATE OR REPLACE FUNCTION public.request_more_business_partner_info(request_id_param uuid, notes_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review business partner requests';
  end if;

  if notes_param is null or trim(notes_param) = '' then
    raise exception 'A note is required so the applicant knows what to add.';
  end if;

  update business_partner_requests
  set status = 'needs_info', reviewed_at = now(), reviewed_by = auth.uid(), admin_notes = notes_param
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  if coalesce((select notify_business from profiles where id = req.requester_id), true) then
    perform public._send_push(req.requester_id, 'We need a bit more information', notes_param, jsonb_build_object('type', 'business_partner_needs_info', 'request_id', request_id_param));
  end if;
end;
$function$;

-- respond_to_business_partnership_request
CREATE OR REPLACE FUNCTION public.respond_to_business_partnership_request(request_id_param uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_business_name text;
  v_target_title text;
begin
  select * into v_request from business_partnership_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found';
  end if;

  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = v_request.partner_id) then
    raise exception 'Only the target business owner can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update business_partnership_requests
  set status = case when approve then 'approved' else 'declined' end, reviewed_at = now()
  where id = request_id_param;

  if approve then
    perform set_config('app.trusted_update', 'true', true);
    if v_request.target_type = 'gathering' then
      update gatherings set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    else
      update communities set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    end if;
  end if;

  select name into v_business_name from brand_partners where id = v_request.partner_id;
  if v_request.target_type = 'gathering' then
    select title into v_target_title from gatherings where id = v_request.target_id;
  else
    select name into v_target_title from communities where id = v_request.target_id;
  end if;

  if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
    perform public._send_push(v_request.requester_id, case when approve then coalesce(v_business_name, 'A business') || ' accepted your partnership request' else coalesce(v_business_name, 'A business') || ' declined your partnership request' end, coalesce(v_target_title, 'Your gathering'), jsonb_build_object('type', 'business_partnership_response', 'target_type', v_request.target_type, 'target_id', v_request.target_id));
  end if;
end;
$function$;

-- respond_to_date_proposal
CREATE OR REPLACE FUNCTION public.respond_to_date_proposal(proposal_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_match record;
  v_responder_name text;
begin
  select * into v_proposal from date_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Plan not found.';
  end if;
  if v_proposal.status <> 'proposed' then
    raise exception 'This plan has already been responded to.';
  end if;

  select * into v_match from matches where id = v_proposal.match_id;
  if v_match is null or (auth.uid() <> v_match.user_a and auth.uid() <> v_match.user_b) then
    raise exception 'You are not part of this match.';
  end if;
  if auth.uid() = v_proposal.proposed_by then
    raise exception 'The other person needs to respond to this plan, not you.';
  end if;

  update date_proposals
  set status = case when accept_param then 'accepted' else 'declined' end, responded_at = now()
  where id = proposal_id_param;

  select display_name into v_responder_name from profiles where id = auth.uid();
  if coalesce((select notify_planning from profiles where id = v_proposal.proposed_by), true) then
    perform public._send_push(v_proposal.proposed_by, case when accept_param then 'Your match said yes! 🎉' else 'An update on your plan' end, coalesce(v_responder_name, 'Your match') || case when accept_param then ' accepted your plan.' else ' can''t make that plan work this time.' end, jsonb_build_object('type', 'date_proposal_response', 'proposal_id', proposal_id_param, 'match_id', v_proposal.match_id, 'accepted', accept_param));
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

-- respond_to_group_plan
CREATE OR REPLACE FUNCTION public.respond_to_group_plan(proposal_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_participant record;
  v_responder_name text;
  v_wants_notif boolean;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan is no longer open for responses.';
  end if;
  if v_proposal.expires_at < now() then
    raise exception 'This group plan invite has expired.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = auth.uid() for update;
  if v_participant is null then
    raise exception 'You were not invited to this group plan.';
  end if;
  if v_participant.status <> 'invited' then
    raise exception 'You have already responded to this group plan.';
  end if;

  if is_blocked(auth.uid(), v_proposal.initiator_id) then
    raise exception 'This group plan is no longer available.';
  end if;

  update group_plan_participants
  set status = case when accept_param then 'accepted' else 'declined' end, responded_at = now()
  where id = v_participant.id;

  -- Item 125: recorded only (a decline is not a registry event)
  if accept_param then
    perform public._emit_event('INVITATION_ACCEPTED', 'group_plan_participant', v_participant.id, auth.uid(), 'respond_to_group_plan',
      jsonb_build_object('participant_id', v_participant.id, 'proposal_id', proposal_id_param), 'INVITATION_ACCEPTED:' || v_participant.id);
  end if;

  select display_name into v_responder_name from profiles where id = auth.uid();
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_proposal.initiator_id;
  if v_wants_notif then
    perform public._send_push(v_proposal.initiator_id, case when accept_param then 'Group plan accepted' else 'Group plan response' end, coalesce(v_responder_name, 'Someone') || (case when accept_param then ' joined your group plan.' else ' can''t join your group plan.' end), jsonb_build_object('type', 'group_plan_response', 'proposal_id', proposal_id_param));
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

-- respond_to_occasion_group_plan_guest_invite
CREATE OR REPLACE FUNCTION public.respond_to_occasion_group_plan_guest_invite(token_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_participant record;
  v_plan record;
  v_new_status text;
  v_wants_notif boolean;
  v_past boolean;
begin
  select * into v_participant from occasion_group_plan_participants
  where guest_token = token_param and user_id is null;
  if v_participant is null then
    raise exception 'This invite link is no longer valid.';
  end if;

  select * into v_plan from occasion_group_plans where id = v_participant.group_plan_id;
  if v_plan is null or v_plan.status = 'cancelled' then
    raise exception 'This plan is no longer available.';
  end if;
  if v_participant.status <> 'invited' then
    raise exception 'This invite has already been responded to.';
  end if;

  v_past := public._occasion_plan_is_past(v_plan.scheduled_date);
  if v_past and accept_param then
    raise exception 'This invitation has expired: the plan date has already passed';
  end if;

  v_new_status := case when v_past then 'expired' when accept_param then 'joined' else 'declined' end;

  update occasion_group_plan_participants
  set status = v_new_status, responded_at = now()
  where id = v_participant.id;

  -- Item 125: a guest answering an occasion invite, recorded only (the host's existing RSVP push below is unchanged)
  if v_past then
    perform public._emit_event('INVITATION_EXPIRED', 'occasion_group_plan_participant', v_participant.id, null, 'respond_to_occasion_group_plan_guest_invite',
      jsonb_build_object('participant_id', v_participant.id, 'plan_id', v_plan.id), 'INVITATION_EXPIRED:' || v_participant.id);
  elsif accept_param then
    perform public._emit_event('INVITATION_ACCEPTED', 'occasion_group_plan_participant', v_participant.id, null, 'respond_to_occasion_group_plan_guest_invite',
      jsonb_build_object('participant_id', v_participant.id, 'plan_id', v_plan.id), 'INVITATION_ACCEPTED:' || v_participant.id);
  end if;

  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_plan.host_id;
  if not v_past and v_wants_notif then
    perform public._send_push(v_plan.host_id, case when accept_param then '🎉 ' || v_participant.guest_name || ' is in!' else '🙈 ' || v_participant.guest_name || ' can''t make it' end, v_participant.guest_name || (case when accept_param then ' is coming to ' else ' can''t make it to ' end) || v_plan.title || '.', jsonb_build_object('type', 'occasion_group_plan_guest_rsvp', 'plan_id', v_plan.id));
  end if;

  return jsonb_build_object('guestStatus', v_new_status);
end;
$function$;

-- respond_to_social_offer
CREATE OR REPLACE FUNCTION public.respond_to_social_offer(offer_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer_id uuid;
  v_offerer_id uuid;
  v_request_id uuid;
  v_requester_name text;
  v_proposal_id uuid;
begin
  select so.id, so.offerer_id, so.request_id
  into v_offer_id, v_offerer_id, v_request_id
  from social_offers so
  join business_requests br on br.id = so.request_id
  where so.id = offer_id_param
  and br.requester_id = auth.uid()
  and so.status = 'offered'
  for update of so;

  if v_offer_id is null then
    raise exception 'Offer not found or already responded to.';
  end if;

  update social_offers
  set status = case when accept_param then 'accepted' else 'declined' end,
      responded_at = now()
  where id = v_offer_id;

  select id into v_proposal_id from group_plan_proposals where resulting_request_id = v_request_id limit 1;

  select display_name into v_requester_name from profiles where id = auth.uid();
  if coalesce((select notify_planning from profiles where id = v_offerer_id), true) then
    perform public._send_push(v_offerer_id, case when accept_param then 'Your offer was accepted! 🎉' else 'An update on your offer' end, coalesce(v_requester_name, 'Someone') || case when accept_param then ' accepted your offer.' else ' went a different way this time -- thanks for offering.' end, jsonb_build_object('type', 'social_offer_responded', 'offer_id', v_offer_id, 'accepted', accept_param, 'proposal_id', v_proposal_id));
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

-- reveal_occasion
CREATE OR REPLACE FUNCTION public.reveal_occasion(occasion_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_occasion record;
  v_host_name text;
  v_wants_notif boolean;
  v_notified boolean := false;
begin
  select * into v_occasion from occasions where id = occasion_id_param and user_id = auth.uid() for update;
  if v_occasion is null then
    raise exception 'Occasion not found.';
  end if;
  if not v_occasion.surprise_mode then
    raise exception 'This occasion isn''t a surprise.';
  end if;

  update occasions
  set surprise_mode = false,
      connected_user_id = who_for_friend_id
  where id = occasion_id_param;

  if v_occasion.resulting_plan_id is not null then
    perform public._clear_surprise_on_resulting_business_requests(v_occasion.resulting_plan_id);
  end if;

  if v_occasion.who_for_friend_id is not null then
    select display_name into v_host_name from profiles where id = auth.uid();
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_occasion.who_for_friend_id;
    if v_wants_notif then
      perform public._send_push(v_occasion.who_for_friend_id, '🎉 Surprise!', coalesce(v_host_name, 'Someone you know') || ' let you in on the surprise -- check out ' || v_occasion.title || '.', jsonb_build_object('type', 'occasion_surprise_revealed', 'occasion_id', occasion_id_param, 'owner_id', auth.uid()));
      v_notified := true;
    end if;
  end if;

  return jsonb_build_object('revealed', true, 'notified', v_notified);
end;
$function$;

-- reveal_occasion_group_plan
CREATE OR REPLACE FUNCTION public.reveal_occasion_group_plan(plan_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_host_name text;
  v_wants_notif boolean;
  v_notified boolean := false;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if not v_plan.surprise_mode then
    raise exception 'This plan isn''t a surprise.';
  end if;

  update occasion_group_plans set surprise_mode = false where id = plan_id_param;

  if v_plan.resulting_plan_id is not null then
    perform public._clear_surprise_on_resulting_business_requests(v_plan.resulting_plan_id);
  end if;

  if v_plan.who_for_friend_id is not null then
    insert into occasion_group_plan_participants (group_plan_id, user_id, status)
    values (plan_id_param, v_plan.who_for_friend_id, 'invited')
    on conflict (group_plan_id, user_id) do nothing;

    select display_name into v_host_name from profiles where id = auth.uid();
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_plan.who_for_friend_id;
    if v_wants_notif then
      perform public._send_push(v_plan.who_for_friend_id, '🎉 Surprise!', coalesce(v_host_name, 'Someone you know') || ' let you in on the surprise -- check out ' || v_plan.title || '.', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', plan_id_param));
      v_notified := true;
    end if;
  end if;

  return jsonb_build_object('revealed', true, 'notified', v_notified);
end;
$function$;

-- send_birthday_planning_nudges
CREATE OR REPLACE FUNCTION public.send_birthday_planning_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_days constant int := 7;
  birthday_person record;
  connection record;
  v_today_in_their_tz date;
  v_next_bday date;
  v_year int;
  v_month int;
  v_day int;
begin

  -- Source 1 only: a connected friend/match's real profiles.birthdate.
  -- Self-logged birthday occasions (a non-Nearby person, or a manual
  -- entry) are now covered by send_occasion_planning_nudges() below.
  for birthday_person in
    select id, display_name, birthdate, coalesce(timezone, 'UTC') as timezone from profiles
    where birthdate is not null
  loop
    begin
      v_today_in_their_tz := (now() at time zone birthday_person.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
    end;

    v_year := extract(year from v_today_in_their_tz)::int;
    v_month := extract(month from birthday_person.birthdate)::int;
    v_day := extract(day from birthday_person.birthdate)::int;

    begin
      v_next_bday := make_date(v_year, v_month, v_day);
    exception when others then
      v_next_bday := make_date(v_year, 2, 28);
    end;
    if v_next_bday < v_today_in_their_tz then
      begin
        v_next_bday := make_date(v_year + 1, v_month, v_day);
      exception when others then
        v_next_bday := make_date(v_year + 1, 2, 28);
      end;
    end if;

    if (v_next_bday - v_today_in_their_tz) = v_lead_days then
      for connection in
        select case when m.user_a = birthday_person.id then m.user_b else m.user_a end as connection_id
        from matches m
        where m.user_a = birthday_person.id or m.user_b = birthday_person.id
        union
        select case when f.user_a = birthday_person.id then f.user_b else f.user_a end as connection_id
        from friendships f
        where f.status = 'accepted' and (f.user_a = birthday_person.id or f.user_b = birthday_person.id)
      loop
        if coalesce((select notify_social from profiles where id = connection.connection_id), true) then
          perform public._send_push(connection.connection_id, '🎂 Upcoming Birthday', coalesce(birthday_person.display_name, 'A connection') || '''s birthday is in ' || v_lead_days || ' days. Plan something?', jsonb_build_object(
                'type', 'birthday_upcoming',
                'birthday_user_id', birthday_person.id,
                'display_name', birthday_person.display_name
              ));
        end if;
      end loop;
    end if;
  end loop;
end;
$function$;

-- send_birthday_reminders
CREATE OR REPLACE FUNCTION public.send_birthday_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  birthday_person record;
  connection record;
  v_today_in_their_tz date;
begin

  for birthday_person in
    select id, display_name, birthdate, coalesce(timezone, 'UTC') as timezone from profiles
    where birthdate is not null
  loop
    -- Each person's "today" is computed in their own timezone, not
    -- the server's — otherwise this cron could fire a day early or
    -- late depending on how far someone's local time differs from
    -- wherever the database server actually runs.
    begin
      v_today_in_their_tz := (now() at time zone birthday_person.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
    end;

    if extract(month from birthday_person.birthdate) = extract(month from v_today_in_their_tz)
    and extract(day from birthday_person.birthdate) = extract(day from v_today_in_their_tz) then

      for connection in
        select case when m.user_a = birthday_person.id then m.user_b else m.user_a end as connection_id
        from matches m
        where m.user_a = birthday_person.id or m.user_b = birthday_person.id
        union
        select case when f.user_a = birthday_person.id then f.user_b else f.user_a end as connection_id
        from friendships f
        where f.status = 'accepted' and (f.user_a = birthday_person.id or f.user_b = birthday_person.id)
      loop
        if coalesce((select notify_social from profiles where id = connection.connection_id), true) then
          perform public._send_push(connection.connection_id, '🎂 Birthday Today', 'It''s ' || coalesce(birthday_person.display_name, 'a connection') || '''s birthday today!', jsonb_build_object('type', 'birthday', 'birthday_user_id', birthday_person.id));
        end if;
      end loop;
    end if;
  end loop;
end;
$function$;

-- send_business_opportunity_digests
CREATE OR REPLACE FUNCTION public.send_business_opportunity_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_since timestamptz;
  v_count integer;
  v_sent integer := 0;
begin

  for v_row in
    select p.id as user_id, p.managed_partner_id as partner_id, s.last_digest_at
    from profiles p
    left join business_opportunity_digest_state s on s.user_id = p.id
    where p.managed_partner_id is not null
      and coalesce(p.notify_business, true)
      and (s.last_digest_at is null or s.last_digest_at <= now() - interval '6 hours')
  loop
    v_since := coalesce(v_row.last_digest_at, now() - interval '1 day');
    select count(*) into v_count
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where o.partner_id = v_row.partner_id
      and o.status = 'pending'
      and o.created_at > v_since
      and r.status = 'open'
      and r.expires_at > now()
      and not public._opportunity_is_urgent(r.id)
      and not o.is_directed;
    continue when v_count = 0;

    perform public._send_push(v_row.user_id, v_count || ' new ' || case when v_count = 1 then 'opportunity' else 'opportunities' end || ' that fit your business', 'Nearby matched them for you. Open to view and reply.', jsonb_build_object('type', 'business_opportunities_digest', 'count', v_count));
    insert into business_opportunity_digest_state (user_id, last_digest_at) values (v_row.user_id, now())
    on conflict (user_id) do update set last_digest_at = excluded.last_digest_at;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;

-- send_business_recall_outreach
CREATE OR REPLACE FUNCTION public.send_business_recall_outreach(occasion_id_param uuid, partner_id_param uuid, package_id_param uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_occasion record;
  v_offer record;
  v_partner record;
  v_package record;
  v_body text;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  select * into v_occasion from occasions where id = occasion_id_param;
  if v_occasion.id is null then
    raise exception 'Occasion not found';
  end if;
  if not v_occasion.recall_shareable_with_business then
    raise exception 'This customer has not made this occasion shareable';
  end if;
  if not v_occasion.recurs_annually or v_occasion.resulting_plan_id is null then
    raise exception 'No real returning-customer history for this occasion';
  end if;

  -- Same real ownership check as get_business_returning_occasion_customers
  -- -- a business can only reach out about its OWN real fulfillment
  -- history with this customer, never borrow another business's.
  select bro.* into v_offer
  from plans pl
  join business_request_offers bro on bro.request_id = pl.resulting_business_request_id
  where pl.id = v_occasion.resulting_plan_id
    and bro.partner_id = partner_id_param
    and bro.status in ('accepted', 'completed')
  order by coalesce(bro.accepted_at, bro.completed_at) desc nulls last
  limit 1;

  if v_offer.id is null then
    raise exception 'No real fulfillment history with this business for this occasion';
  end if;

  -- Rate limit: once per real occurrence, mirroring send_occasion_
  -- planning_nudges()' own once-per-year dedup shape -- a business can't
  -- spam a returning customer with repeated "welcome back" pushes.
  if v_occasion.last_business_outreach_at is not null
     and v_occasion.last_business_outreach_at > (now() - interval '350 days') then
    raise exception 'Already reached out about this occasion recently';
  end if;

  select * into v_partner from brand_partners where id = partner_id_param;
  if v_partner.id is null then
    raise exception 'Business not found';
  end if;

  if package_id_param is not null then
    select * into v_package from business_occasion_packages
    where id = package_id_param and partner_id = partner_id_param;
    if v_package.id is null then
      raise exception 'Package not found';
    end if;
  end if;

  update occasions set last_business_outreach_at = now() where id = occasion_id_param;

  v_body := case
    when v_package.id is not null then 'Welcome back -- ask about our ' || v_package.name || '.'
    else 'Welcome back -- we would love to help you celebrate again.'
  end;

  perform public._send_push(v_occasion.user_id, _occasion_emoji(v_occasion.occasion_type) || ' ' || v_partner.name || ' says hello!', v_body, jsonb_build_object(
        'type', 'business_recall_outreach',
        'occasion_id', v_occasion.id,
        'partner_id', partner_id_param,
        'partner_name', v_partner.name,
        'package_id', package_id_param,
        'package_name', v_package.name
      ));
end;
$function$;

-- send_first_mission_reminders
CREATE OR REPLACE FUNCTION public.send_first_mission_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  candidate record;
  v_today_in_their_tz date;
  v_signup_date_in_their_tz date;
  v_days_since_signup integer;
  v_has_said_yes boolean;
begin

  for candidate in
    select id, display_name, created_at, coalesce(timezone, 'UTC') as timezone, coalesce(notify_discovery, true) as wants_notif from profiles
  loop
    if not candidate.wants_notif then
      continue;
    end if;

    begin
      v_today_in_their_tz := (now() at time zone candidate.timezone)::date;
      v_signup_date_in_their_tz := (candidate.created_at at time zone candidate.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
      v_signup_date_in_their_tz := candidate.created_at::date;
    end;

    v_days_since_signup := v_today_in_their_tz - v_signup_date_in_their_tz;

    -- A narrow 3-4 day window, checked daily — fires exactly once
    -- per person rather than repeating every day someone remains
    -- inactive, which would feel naggy rather than encouraging.
    if v_days_since_signup in (3, 4) then
      select exists (
        select 1 from gathering_interest gi
        where gi.user_id = candidate.id
        and gi.status = 'approved'
        and gi.created_at >= candidate.created_at
      ) into v_has_said_yes;

      if not v_has_said_yes then
        perform public._send_push(candidate.id, 'Your mission is still waiting', 'Say yes to one thing this week — there''s still time.', jsonb_build_object('type', 'first_mission_reminder'));
      end if;
    end if;
  end loop;
end;
$function$;

-- send_gathering_business_reminders
CREATE OR REPLACE FUNCTION public.send_gathering_business_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_sent integer := 0;
begin
  for v_row in select * from public._gathering_business_reminder_candidates() loop
    -- Record first (primary key = one reminder per gathering, ever), then push.
    insert into gathering_business_reminders (gathering_id) values (v_row.gathering_id) on conflict do nothing;
    continue when not found;
    perform public._send_push(v_row.host_id, 'Want local business options?', 'You asked us to look for local business options for "' || v_row.title || '". Ready to see what''s available?', jsonb_build_object('type', 'gathering_business_reminder', 'gathering_id', v_row.gathering_id));
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;

-- send_gathering_reminders
CREATE OR REPLACE FUNCTION public.send_gathering_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
  attendee record;
begin

  for g in
    select id, host_id, title, scheduled_at
    from gatherings
    where reminder_sent = false
      and scheduled_at > now()
      and scheduled_at <= now() + interval '2 hours'
  loop
    if coalesce((select notify_planning from profiles where id = g.host_id), true) then
      perform public._send_push(g.host_id, 'Your gathering starts soon', '"' || g.title || '" starts ' || case
              when g.scheduled_at - now() < interval '50 minutes'
                then 'in about ' || greatest(5, (round(extract(epoch from g.scheduled_at - now()) / 300) * 5)::int) || ' minutes'
              when g.scheduled_at - now() < interval '90 minutes' then 'in about an hour'
              else 'in about 2 hours'
            end || '.', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id));
    end if;

    for attendee in
      select gi.user_id from gathering_interest gi where gi.gathering_id = g.id and gi.status = 'approved'
      union
      select gd.user_id from gathering_interested gd
       where gd.gathering_id = g.id
         and not exists (select 1 from blocks b
                          where (b.blocker_id = g.host_id and b.blocked_id = gd.user_id)
                             or (b.blocker_id = gd.user_id and b.blocked_id = g.host_id))
    loop
      if coalesce((select notify_planning from profiles where id = attendee.user_id), true) then
        perform public._send_push(attendee.user_id, 'Gathering starting soon', '"' || g.title || '" starts ' || case
              when g.scheduled_at - now() < interval '50 minutes'
                then 'in about ' || greatest(5, (round(extract(epoch from g.scheduled_at - now()) / 300) * 5)::int) || ' minutes'
              when g.scheduled_at - now() < interval '90 minutes' then 'in about an hour'
              else 'in about 2 hours'
            end || '.', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id));
      end if;
    end loop;

    update gatherings set reminder_sent = true where id = g.id;
  end loop;
end;
$function$;

-- send_match_reminders
CREATE OR REPLACE FUNCTION public.send_match_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record;
begin

  for m in
    select mt.id, mt.user_a, mt.user_b, mt.matched_at,
           a.display_name as a_name, b.display_name as b_name,
           a.notify_dating as a_wants_notif, b.notify_dating as b_wants_notif
    from matches mt
    join profiles a on a.id = mt.user_a
    join profiles b on b.id = mt.user_b
    where mt.matched_at < now() - interval '24 hours'
      and mt.reminder_sent_at is null
      and not exists (select 1 from messages msg where msg.match_id = mt.id)
  loop
    if m.a_wants_notif then
      perform public._send_push(m.user_a, 'Say hi to ' || coalesce(m.b_name, 'your match') || '! 👋', 'You matched a day ago — send the first message.', jsonb_build_object('type', 'match_reminder', 'match_id', m.id));
    end if;

    if m.b_wants_notif then
      perform public._send_push(m.user_b, 'Say hi to ' || coalesce(m.a_name, 'your match') || '! 👋', 'You matched a day ago — send the first message.', jsonb_build_object('type', 'match_reminder', 'match_id', m.id));
    end if;

    update matches set reminder_sent_at = now() where id = m.id;
  end loop;
end;
$function$;

-- send_momentum_nudges
CREATE OR REPLACE FUNCTION public.send_momentum_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  u record;
  wk int;
  week_has_activity boolean;
  streak int;
  current_week_activity boolean;
  redemption_count int;
  next_tier_min int;
  next_tier_name text;
  next_tier_emoji text;
begin

  for u in select id, display_name, coalesce(notify_discovery, true) as wants_notif from profiles loop
    if not u.wants_notif then
      continue;
    end if;

    -- ---------- streak signal (mirrors getMomentumStats' weekly-bucket logic) ----------
    -- Consecutive completed weeks (not counting the current, still-in-progress
    -- week) with at least one attended-or-hosted gathering, counting back up
    -- to 8 weeks — same lookback window the Momentum screen itself uses.
    streak := 0;
    for wk in 1..8 loop
      select exists (
        select 1 from gathering_interest gi
        join gatherings g on g.id = gi.gathering_id
        where gi.user_id = u.id and gi.status = 'approved'
          and g.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
        union
        select 1 from gatherings g2
        where g2.host_id = u.id
          and g2.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g2.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
      ) into week_has_activity;

      exit when not week_has_activity;
      streak := streak + 1;
    end loop;

    select exists (
      select 1 from gathering_interest gi
      join gatherings g on g.id = gi.gathering_id
      where gi.user_id = u.id and gi.status = 'approved' and g.scheduled_at >= date_trunc('week', now())
      union
      select 1 from gatherings g2
      where g2.host_id = u.id and g2.scheduled_at >= date_trunc('week', now())
    ) into current_week_activity;

    if streak >= 2 and not current_week_activity then
      perform public._send_push(u.id, '🔥 Keep your streak going', 'You''ve been active ' || streak || ' weeks in a row — join or host something this week to keep it up.', jsonb_build_object('type', 'momentum_streak_nudge'));
      continue; -- one nudge per person per run; don't also send the tier nudge below
    end if;

    -- ---------- reward-tier-proximity signal (mirrors getMyRewardStatus) ----------
    select count(*) into redemption_count from offer_redemptions where user_id = u.id;

    select min, name, emoji into next_tier_min, next_tier_name, next_tier_emoji
    from (values (5, 'Bronze', '🥉'), (15, 'Silver', '🥈'), (30, 'Gold', '🥇')) as tiers(min, name, emoji)
    where tiers.min > redemption_count
    order by tiers.min asc
    limit 1;

    if next_tier_min is not null and (next_tier_min - redemption_count) <= 2 then
      perform public._send_push(u.id, next_tier_emoji || ' Almost at ' || next_tier_name, (next_tier_min - redemption_count) || ' more redemption' || (case when (next_tier_min - redemption_count) = 1 then '' else 's' end) || ' and you''re ' || next_tier_name || '.', jsonb_build_object('type', 'reward_tier_nudge'));
    end if;
  end loop;
end;
$function$;

-- send_occasion_group_plan_stall_nudges
CREATE OR REPLACE FUNCTION public.send_occasion_group_plan_stall_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  plan_row record;
begin

  for plan_row in
    select id, host_id, occasion_type
    from occasion_group_plans
    where status in ('voting', 'voting_business')
    and stall_nudge_sent_at is null
    and (
      created_at <= now() - interval '3 days'
      or (scheduled_date is not null and scheduled_date >= current_date and scheduled_date - current_date <= 3)
    )
  loop
    update occasion_group_plans set stall_nudge_sent_at = now() where id = plan_row.id;

    if coalesce((select notify_planning from profiles where id = plan_row.host_id), true) then
      perform public._send_push(plan_row.host_id, '🎉 Still deciding?', 'Your group hasn''t finalized the ' || lower(_occasion_noun(plan_row.occasion_type)) || ' plan yet.', jsonb_build_object('type', 'occasion_group_plan_stalled', 'plan_id', plan_row.id));
    end if;
  end loop;
end;
$function$;

-- send_occasion_planning_nudges
CREATE OR REPLACE FUNCTION public.send_occasion_planning_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  occasion_row record;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
  v_lead_days int;
  v_body_suffix text;
  v_push_body text;
  v_trigger_today boolean;
  v_date_text text;
  v_recall_partner_name text;
  v_has_recall boolean;
begin

  for occasion_row in
    select id, user_id, occasion_type, title, occasion_date, date_precision, recurs_annually,
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at, reminder_enabled
    from occasions
    where reminder_enabled
  loop
    if occasion_row.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from occasion_row.occasion_date)::int;
      v_day := extract(day from occasion_row.occasion_date)::int;
      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;
      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;
    else
      v_next_date := occasion_row.occasion_date;
    end if;

    v_lead_days := case occasion_row.occasion_type
      when 'anniversary' then 14
      when 'graduation' then 14
      when 'baby_shower' then 14
      when 'engagement' then 14
      when 'housewarming' then 14
      else 7
    end;

    if occasion_row.date_precision = 'flexible' then
      v_trigger_today := current_date = (date_trunc('month', v_next_date)::date - 5);
    else
      v_trigger_today := (v_next_date - current_date) = v_lead_days;
    end if;

    if not v_trigger_today then
      continue;
    end if;

    -- Already turned into a real plan for this upcoming date -- don't nag
    -- about something the user already handled. See this migration's own
    -- header comment for why ~350 days is an honest approximation, not an
    -- exact per-year-instance check this table has no way to make.
    if occasion_row.resulting_plan_id is not null
       and occasion_row.last_planned_at is not null
       and occasion_row.last_planned_at > (v_next_date - interval '350 days') then
      continue;
    end if;

    if not coalesce((select notify_social from profiles where id = occasion_row.user_id), true) then
      continue;
    end if;

    -- Item 101: a real prior-year memory, resolved the exact same way
    -- get_occasion_recall() resolves it for the client -- when
    -- resulting_plan_id exists at all (this occasion has genuine history,
    -- not a first-time ask), look up the real business it was last
    -- fulfilled through. Deliberately inline rather than calling
    -- get_occasion_recall() itself: that function is STABLE and reads
    -- auth.uid(), which has no meaning inside this SECURITY DEFINER cron
    -- loop iterating over every user's own occasions.
    v_recall_partner_name := null;
    if occasion_row.resulting_plan_id is not null then
      select bp.name into v_recall_partner_name
      from plans pl
      join business_request_offers bro on bro.request_id = pl.resulting_business_request_id
      join brand_partners bp on bp.id = bro.partner_id
      where pl.id = occasion_row.resulting_plan_id
        and bro.status in ('accepted', 'completed')
      order by coalesce(bro.accepted_at, bro.completed_at) desc nulls last
      limit 1;
    end if;
    v_has_recall := v_recall_partner_name is not null;

    v_body_suffix := case occasion_row.occasion_type when 'anniversary' then 'together?' else '?' end;
    v_date_text := to_char(v_next_date, 'FMMonth FMDD');

    if v_has_recall and occasion_row.date_precision = 'exact' then
      v_push_body := occasion_row.title || ' is in ' || v_lead_days
        || ' days. Want to return to ' || v_recall_partner_name || ' or try something new?';
    else
      v_push_body := case occasion_row.date_precision
        when 'weekend' then occasion_row.title || ' is coming up the weekend of ' || v_date_text || '. Plan something' || v_body_suffix
        when 'around' then occasion_row.title || ' is coming up around ' || v_date_text || '. Plan something' || v_body_suffix
        when 'flexible' then occasion_row.title || ' is coming up sometime ' || to_char(v_next_date, 'FMMonth') || '. Plan ahead' || v_body_suffix
        else occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something' || v_body_suffix
      end;
    end if;

    perform public._send_push(occasion_row.user_id, _occasion_emoji(occasion_row.occasion_type) || ' ' || (case when v_has_recall then 'Plan Again?' else 'Upcoming ' || _occasion_noun(occasion_row.occasion_type) end), v_push_body, jsonb_build_object(
          'type', 'occasion_upcoming',
          'occasion_id', occasion_row.id,
          'occasion_type', occasion_row.occasion_type,
          'occasion_title', occasion_row.title,
          'who_for_name', occasion_row.who_for_name,
          'who_for_friend_id', occasion_row.who_for_friend_id,
          'has_recall', v_has_recall
        ));
  end loop;
end;
$function$;

-- send_preference_poll
CREATE OR REPLACE FUNCTION public.send_preference_poll(target_id_param uuid, question_key_param text, occasion_context_param text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_poll_id uuid;
  v_asker_name text;
  v_question_text text;
  v_wants_notif boolean;
begin
  if target_id_param is null or target_id_param = auth.uid() then
    raise exception 'You can''t ask yourself.';
  end if;
  if question_key_param not in ('cuisine_mood', 'venue_vibe') then
    raise exception 'Invalid question.';
  end if;
  if is_blocked(auth.uid(), target_id_param) then
    raise exception 'You can''t send this to that person.';
  end if;

  -- Real connections only -- same eligibility check this schema's other
  -- friend-facing RPCs already use; standing "no stranger discovery" rule.
  if not (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
      and ((f.user_a = auth.uid() and f.user_b = target_id_param) or (f.user_a = target_id_param and f.user_b = auth.uid()))
    )
    or exists (
      select 1 from matches m
      where (m.user_a = auth.uid() and m.user_b = target_id_param) or (m.user_a = target_id_param and m.user_b = auth.uid())
    )
  ) then
    raise exception 'You can only ask a real connection.';
  end if;

  -- One pending question at a time per (asker, target) pair -- a simple,
  -- honest rate limit against accidentally spamming someone with several
  -- "quick questions" that would themselves become a tell.
  if exists (
    select 1 from preference_polls
    where asker_id = auth.uid() and target_id = target_id_param
      and answer_keys is null and expires_at > now()
  ) then
    raise exception 'You already have a question pending with them.';
  end if;

  v_question_text := case question_key_param
    when 'cuisine_mood' then 'What kind of food are you in the mood for lately?'
    when 'venue_vibe' then 'What''s your ideal night-out vibe?'
  end;

  insert into preference_polls (asker_id, target_id, question_key, occasion_context)
  values (auth.uid(), target_id_param, question_key_param, occasion_context_param)
  returning id into v_poll_id;

  select display_name into v_asker_name from profiles where id = auth.uid();
  select coalesce(notify_social, true) into v_wants_notif from profiles where id = target_id_param;

  -- Deliberately plain and unremarkable -- no occasion/plan reference of
  -- any kind, ever, in this push. This is the whole point of the feature.
  if v_wants_notif then
    perform public._send_push(target_id_param, '💬 Quick question', coalesce(v_asker_name, 'Someone you know') || ' wants to know: ' || v_question_text, jsonb_build_object('type', 'preference_poll_received', 'poll_id', v_poll_id));
  end if;

  return v_poll_id;
end;
$function$;

-- set_group_plan_budget
CREATE OR REPLACE FUNCTION public.set_group_plan_budget(proposal_id_param uuid, agreed_budget_max_param integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_reset_user_ids uuid[];
  v_notify_id uuid;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can set its budget.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan is no longer pending.';
  end if;
  if agreed_budget_max_param is not null then
    if agreed_budget_max_param < 0 then
      raise exception 'Budget must be a real, non-negative amount.';
    end if;
    if v_proposal.proposed_budget_min is not null and agreed_budget_max_param < v_proposal.proposed_budget_min then
      raise exception 'That is below what anyone in the group said they could spend.';
    end if;
    if v_proposal.proposed_budget_max is not null and agreed_budget_max_param > v_proposal.proposed_budget_max then
      raise exception 'That is above what anyone in the group said they could spend.';
    end if;
  end if;

  update group_plan_proposals set agreed_budget_max = agreed_budget_max_param where id = proposal_id_param;

  select array_agg(user_id) into v_reset_user_ids
  from group_plan_participants
  where proposal_id = proposal_id_param and user_id <> v_proposal.initiator_id and status = 'accepted';

  if v_reset_user_ids is not null then
    update group_plan_participants
    set status = 'invited', responded_at = null
    where proposal_id = proposal_id_param and user_id = any(v_reset_user_ids);

    foreach v_notify_id in array v_reset_user_ids loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_id), true);
      perform public._send_push(v_notify_id, 'Group plan budget changed', 'The budget for your group plan changed -- please confirm you''re still in.', jsonb_build_object('type', 'group_plan_response', 'proposal_id', proposal_id_param));
    end loop;
  end if;

  return jsonb_build_object('success', true, 'resetCount', coalesce(array_length(v_reset_user_ids, 1), 0));
end;
$function$;

-- set_occasion_group_plan_date
CREATE OR REPLACE FUNCTION public.set_occasion_group_plan_date(plan_id_param uuid, scheduled_date_param date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_participant record;
  v_wants_notif boolean;
  v_date_text text;
begin
  if scheduled_date_param is null then
    raise exception 'A real date is required.';
  end if;

  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status in ('cancelled', 'fulfilled') then
    raise exception 'This plan is no longer open for scheduling.';
  end if;

  update occasion_group_plans
  set scheduled_date = scheduled_date_param, when_preset = 'custom'
  where id = plan_id_param;

  v_date_text := to_char(scheduled_date_param, 'FMDay, FMMonth FMDD');

  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if v_wants_notif then
      perform public._send_push(v_participant.user_id, '📅 The date is set!', v_plan.title || ' is now planned for ' || v_date_text || '.', jsonb_build_object('type', 'occasion_group_plan_date_set', 'plan_id', plan_id_param));
    end if;
  end loop;
end;
$function$;

-- set_occasion_group_plan_organizer
CREATE OR REPLACE FUNCTION public.set_occasion_group_plan_organizer(plan_id_param uuid, user_id_param uuid, is_organizer_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_host boolean;
  v_target_status text;
  v_host_name text;
  v_title text;
  v_wants_notif boolean;
begin
  select (host_id = auth.uid()), title into v_is_host, v_title from occasion_group_plans where id = plan_id_param;
  if v_is_host is null then
    raise exception 'This plan does not exist.';
  end if;
  if not v_is_host then
    raise exception 'Only the host can set organizers.';
  end if;
  if user_id_param = auth.uid() then
    raise exception 'The host is already an organizer.';
  end if;

  select status into v_target_status from occasion_group_plan_participants
  where group_plan_id = plan_id_param and user_id = user_id_param;
  if v_target_status is null then
    raise exception 'That person is not part of this plan.';
  end if;
  if v_target_status <> 'joined' then
    raise exception 'Only someone who has joined the plan can be made an organizer.';
  end if;

  update occasion_group_plan_participants
  set is_organizer = is_organizer_param
  where group_plan_id = plan_id_param and user_id = user_id_param;

  if is_organizer_param then
    select display_name into v_host_name from profiles where id = auth.uid();
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = user_id_param;
    if v_wants_notif then
      perform public._send_push(user_id_param, '🎗️ You''re now a co-organizer', coalesce(v_host_name, 'Someone you know') || ' made you a co-organizer of ' || coalesce(v_title, 'their occasion') || '.', jsonb_build_object('type', 'occasion_group_plan_decided', 'plan_id', plan_id_param));
    end if;
  end if;
end;
$function$;

-- share_experience_with_friend
CREATE OR REPLACE FUNCTION public.share_experience_with_friend(plan_id_param uuid, friend_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_plan plans%rowtype;
  v_new uuid;
  v_name text;
  v_wants boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_plan from plans where id = plan_id_param and created_by = v_uid and plan_type = 'experience' for update;
  if not found then raise exception 'Not your experience'; end if;
  if v_plan.status not in ('draft', 'confirmed') then raise exception 'This night has ended and can no longer be shared.'; end if;
  if friend_id_param is null or friend_id_param = v_uid then raise exception 'Choose a friend to share with.'; end if;
  if not public._are_connected(v_uid, friend_id_param) then
    raise exception 'You can only share a night with a friend or a match.';
  end if;
  if (select count(*) from plan_shares where plan_id = plan_id_param and user_id is not null) >= 10 then
    raise exception 'You have shared this night with the maximum number of people.';
  end if;

  insert into plan_shares (plan_id, user_id, added_by) values (plan_id_param, friend_id_param, v_uid)
  on conflict do nothing returning id into v_new;
  if v_new is null then return jsonb_build_object('shared', true, 'alreadyShared', true); end if;

  select display_name into v_name from profiles where id = v_uid;
  select coalesce(notify_planning, true) into v_wants from profiles where id = friend_id_param;
  if v_wants then
    perform public._send_push(friend_id_param, '✨ ' || coalesce(v_name, 'A friend') || ' shared a night with you', 'Tap to see the plan.', jsonb_build_object('type', 'experience_shared', 'plan_id', plan_id_param));
  end if;
  return jsonb_build_object('shared', true, 'alreadyShared', false);
end;
$function$;

-- skip_occasion_group_plan_business_vote
CREATE OR REPLACE FUNCTION public.skip_occasion_group_plan_business_vote(plan_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_option record;
  v_party_size integer;
  v_participant record;
  v_wants_notif boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting_business' then
    raise exception 'This plan is not currently voting on businesses.';
  end if;

  select * into v_option from occasion_group_plan_options where id = v_plan.winning_option_id;

  select count(*) into v_party_size from occasion_group_plan_participants
  where group_plan_id = plan_id_param and status = 'joined';

  update occasion_group_plans
  set status = 'decided', decided_at = now()
  where id = plan_id_param;


  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if v_wants_notif then
      perform public._send_push(v_participant.user_id, '🎉 It''s decided!', v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won the vote.', jsonb_build_object('type', 'occasion_group_plan_decided', 'plan_id', plan_id_param));
    end if;
  end loop;

  return jsonb_build_object(
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'activityType', v_option.activity_type,
    'label', v_option.label,
    'partySize', greatest(v_party_size, 1),
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max
  );
end;
$function$;

-- submit_social_offer
CREATE OR REPLACE FUNCTION public.submit_social_offer(request_id_param uuid, offer_description_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_offer_id uuid;
  v_eligible boolean;
  v_offerer_name text;
  v_proposal_id uuid;
begin
  if offer_description_param is null or length(trim(offer_description_param)) = 0 then
    raise exception 'Describe what you can offer.';
  end if;

  select * into v_request from business_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id = auth.uid() then
    raise exception 'You cannot make a social offer on your own request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select (
    not is_blocked(auth.uid(), v_request.requester_id)
    and (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_request.requester_id) or (f.user_a = v_request.requester_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_request.requester_id) or (m.user_a = v_request.requester_id and m.user_b = auth.uid())
      )
      or exists (
        select 1 from community_members cm1
        join community_members cm2 on cm1.community_id = cm2.community_id
        where cm1.user_id = auth.uid() and cm2.user_id = v_request.requester_id
      )
      or exists (
        select 1
        from (
          select gathering_id from gathering_interest where user_id = auth.uid() and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = auth.uid()
        ) mine
        join (
          select gathering_id from gathering_interest where user_id = v_request.requester_id and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = v_request.requester_id
        ) theirs on mine.gathering_id = theirs.gathering_id
      )
    )
  ) into v_eligible;

  if not v_eligible then
    raise exception 'You need to already be connected to this person to make them an offer.';
  end if;

  insert into social_offers (request_id, offerer_id, offer_description, status)
  values (request_id_param, auth.uid(), trim(offer_description_param), 'offered')
  on conflict (request_id, offerer_id) do update
    set offer_description = excluded.offer_description, status = 'offered',
        responded_at = null, viewed_at = null, created_at = now()
    where social_offers.status in ('withdrawn', 'declined', 'expired', 'cancelled')
  returning id into v_offer_id;

  if v_offer_id is null then
    raise exception 'You already made an offer on this request.';
  end if;

  select id into v_proposal_id from group_plan_proposals where resulting_request_id = request_id_param limit 1;

  select display_name into v_offerer_name from profiles where id = auth.uid();
  if coalesce((select notify_planning from profiles where id = v_request.requester_id), true) then
    perform public._send_push(v_request.requester_id, 'Someone offered to help!', coalesce(v_offerer_name, 'Someone you know') || ' made you a social offer: "' || left(trim(offer_description_param), 60) || '"', jsonb_build_object('type', 'social_offer_received', 'request_id', request_id_param, 'offer_id', v_offer_id, 'proposal_id', v_proposal_id));
  end if;

  return jsonb_build_object('success', true, 'offerId', v_offer_id);
end;
$function$;

-- withdraw_business_offer
CREATE OR REPLACE FUNCTION public.withdraw_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_push_title text;
  v_push_body text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where id = offer_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'Offer not found.';
  end if;
  if v_row.status <> 'offered' then
    raise exception 'This offer can no longer be withdrawn.';
  end if;

  update business_request_offers
  set status = 'withdrawn', responded_at = now()
  where id = offer_id_param;

  select requester_id, raw_text into v_requester_id, v_raw_text
  from business_requests where id = v_row.request_id;
  select name into v_partner_name from brand_partners where id = v_partner_id;

  v_push_title := 'An offer was withdrawn';
  v_push_body := coalesce(v_partner_name, 'A business') || ' withdrew its offer on "' || left(v_raw_text, 60) || '"';

  if coalesce((select notify_business from profiles where id = v_requester_id), true) then
    perform public._send_push(v_requester_id, v_push_title, v_push_body, jsonb_build_object('type', 'business_offer_withdrawn', 'request_id', v_row.request_id, 'offer_id', offer_id_param));
  end if;

  perform _notify_other_plan_participants(v_row.request_id, v_requester_id, 'business_offer_declined', v_push_title, v_push_body, jsonb_build_object('offer_id', offer_id_param));

  return jsonb_build_object('success', true);
end;
$function$;

-- invite_guest_to_occasion_group_plan
CREATE OR REPLACE FUNCTION public.invite_guest_to_occasion_group_plan(plan_id_param uuid, guest_name_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_can_invite boolean;
  v_guest_name text;
  v_guest_count integer;
  v_participant_id uuid;
  v_guest_token uuid;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param;
  if v_plan is null then
    raise exception 'This plan does not exist.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'This plan is no longer open for new invites.';
  end if;

  select (v_plan.host_id = auth.uid()) or exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined' and is_organizer
  ) into v_can_invite;
  if not v_can_invite then
    raise exception 'Only the host or an organizer can invite more people.';
  end if;

  v_guest_name := nullif(trim(coalesce(guest_name_param, '')), '');
  if v_guest_name is null then
    raise exception 'This guest needs a name.';
  end if;

  select count(*) into v_guest_count from occasion_group_plan_participants
  where group_plan_id = plan_id_param and user_id is null;
  if v_guest_count >= 20 then
    raise exception 'This plan already has the maximum number of guest invites.';
  end if;

  insert into occasion_group_plan_participants (group_plan_id, guest_name, status)
  values (plan_id_param, v_guest_name, 'invited')
  returning id, guest_token into v_participant_id, v_guest_token;

  -- Item 125: recorded as INVITATION_SENT (a guest link; nobody is pushed). Never the guest's name or token.
  perform public._emit_event('INVITATION_SENT', 'occasion_group_plan_participant', v_participant_id, auth.uid(), 'invite_guest_to_occasion_group_plan',
      jsonb_build_object('participant_id', v_participant_id, 'plan_id', plan_id_param), 'INVITATION_SENT:' || v_participant_id);

  return jsonb_build_object('participantId', v_participant_id, 'guestToken', v_guest_token, 'guestName', v_guest_name);
end;
$function$;

-- respond_to_occasion_group_plan
CREATE OR REPLACE FUNCTION public.respond_to_occasion_group_plan(plan_id_param uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_past boolean;
  v_part_id uuid;
begin
  select public._occasion_plan_is_past(scheduled_date) into v_past
  from occasion_group_plans where id = plan_id_param;
  v_past := coalesce(v_past, false);

  if v_past and accept then
    raise exception 'This invitation has expired: the plan date has already passed';
  end if;

  update occasion_group_plan_participants
  set status = case when v_past then 'expired' when accept then 'joined' else 'declined' end,
      responded_at = now()
  where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'invited'
  returning id into v_part_id;

  if not found then
    raise exception 'No pending invite found for this plan.';
  end if;

  -- Item 125: recorded only (no push, owner decision); a decline is not a registry event
  if v_past then
    perform public._emit_event('INVITATION_EXPIRED', 'occasion_group_plan_participant', v_part_id, auth.uid(), 'respond_to_occasion_group_plan',
      jsonb_build_object('participant_id', v_part_id, 'plan_id', plan_id_param), 'INVITATION_EXPIRED:' || v_part_id);
  elsif accept then
    perform public._emit_event('INVITATION_ACCEPTED', 'occasion_group_plan_participant', v_part_id, auth.uid(), 'respond_to_occasion_group_plan',
      jsonb_build_object('participant_id', v_part_id, 'plan_id', plan_id_param), 'INVITATION_ACCEPTED:' || v_part_id);
  end if;
end;
$function$;

-- _accept_business_offer_internal (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._accept_business_offer_internal(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers set status = 'accepted', accepted_at = now() where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id and id <> offer_id_param and status in ('pending', 'offered');

  update business_requests set status = 'fulfilled' where id = v_request.id;

  -- Item 125: the caller (confirm_group_plan_offer) emits BUSINESS_OFFER_ACCEPTED; the business push lives in its handler.
  return jsonb_build_object('success', true);
end;
$function$;

-- _ai_auto_respond_to_business_requests (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._ai_auto_respond_to_business_requests(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_exp record;
  v_reason text;
  v_offer_price numeric;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bap.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name, p.ai_trust_level
    from business_ai_policies bap
    join brand_partners p on p.id = bap.partner_id and p.active = true
    left join reputation r on r.partner_id = bap.partner_id
    where bap.enabled = true
    and bap.action_type = 'auto_respond_offer'
    and p.ai_trust_level >= 2
    and bap.trust_level <= p.ai_trust_level
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bap.created_at desc
  loop
    v_reason := null;
    v_exp := null;

    if category_param is null or (v_policy.conditions ->> 'category') is distinct from category_param then
      v_reason := 'category_mismatch';
    elsif party_size_param is not null and v_policy.conditions ? 'party_size_max'
          and party_size_param > (v_policy.conditions ->> 'party_size_max')::integer then
      v_reason := 'party_size_out_of_range';
    elsif v_policy.conditions ? 'hours_start' and v_policy.conditions ? 'hours_end'
          and time_window_start_param is not null and time_window_end_param is not null
          and not ((time_window_start_param, time_window_end_param) overlaps
                    ((v_policy.conditions ->> 'hours_start')::time, (v_policy.conditions ->> 'hours_end')::time)) then
      v_reason := 'hours_mismatch';
    else
      select * into v_exp from business_experiences
      where id = (v_policy.conditions ->> 'experience_id')::uuid
      and partner_id = v_policy.partner_id and active = true;

      if v_exp.id is null then
        v_reason := 'experience_inactive';
      end if;
    end if;

    if v_reason is not null then
      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, requires_approval, approval_result, outcome
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('policy_name', v_policy.name),
        false, 'blocked', v_reason
      )
      on conflict (policy_id, (input_ref ->> 'request_id')) where approval_result = 'blocked' do nothing;
      continue;
    end if;

    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    v_offer_price := case v_exp.price_level
      when '$' then 15 when '$$' then 35 when '$$$' then 65 else null
    end;

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, actual_action, confidence, requires_approval, approval_result
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('experience_id', v_exp.id, 'experience_title', v_exp.title, 'price_level', v_exp.price_level),
        jsonb_build_object('offer_type', 'standard', 'offer_price', v_offer_price),
        null, false, 'auto_applied'
      );

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'ai_auto_respond',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id, 'policy_id', v_policy.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  return v_new_count;
end;
$function$;

-- _business_request_fanout (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_req_attributes text[];
  v_req_dietary text[];
  v_req_cuisine text;
  v_req_occasion text;
  v_req_category text;
  v_req_group text;
  v_req_party integer;
  v_children boolean;
  v_pets boolean;
  v_outdoor boolean;
  v_consider double precision;
  v_cands jsonb;
  v_decision bigint;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select attributes, cuisine, occasion, category, party_size, dietary
    into v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category, v_req_party, v_req_dietary
  from business_requests where id = request_id_param;
  -- Category-aware routing (20270130): a request whose category maps to a group only reaches businesses in that
  -- group (declared tags or major). No category / unmapped category = unfiltered, as before. Deterministic, no AI.
  v_req_group := public.request_category_group(v_req_category);
  -- the same request facts _business_declines_request derives (used only to name the reason, never to decide)
  v_children := coalesce(v_req_attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
  v_pets := coalesce(v_req_attributes, '{}') && array['dog_friendly', 'pet_friendly'];
  v_outdoor := 'outdoor_seating' = any(coalesce(v_req_attributes, '{}'));
  v_consider := least(greatest(radius_miles_param * 2, radius_miles_param + 10), 100);

  with considered as (
    select p.id, p.attributes, p.dietary_options, p.cuisine, p.offered_occasions, p.max_group_size,
           p.private_room_capacity, p.outdoor_capacity,
           (3958.8 * acos(least(1.0, greatest(-1.0,
              cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
              sin(radians(latitude_param)) * sin(radians(p.latitude)))))) as distance_miles,
           ((category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
             and (business_major_filter_param is null or p.category = business_major_filter_param)
             and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))) as cat_ok,
           -- item 86: a business that declared something this request conflicts with is never routed it
           public._business_declines_request(p.id, request_id_param) as declines,
           (v_req_party is not null and p.max_group_size is not null and p.max_group_size < v_req_party) as cap_small,
           (public._business_declines(p.id, null, v_children, v_pets, v_outdoor, false, false) is not null) as other_conflict,
           -- item 116 step 2: known closed at the requested time (declared hours / temporary closure), with no live posting covering it
           public._business_closed_for_request(p.id, request_id_param) as closed_then,
           -- item 116 check 7: the request's per-person budget is below the business's declared minimum spend (both known)
           public._business_below_min_spend(p.id, request_id_param) as below_min
    from brand_partners p
    where p.active = true and p.latitude is not null and p.longitude is not null
  ),
  near as (select * from considered where distance_miles <= v_consider),
  reputation as (
    select partner_id, count(*) as total_opportunities,
           round(100.0 * count(*) filter (where status = 'completed')
                 / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
    from business_request_offers group by partner_id
  ),
  scored as (
    select e.*, r.total_opportunities, r.completion_rate,
      -- item 80: a business whose DECLARED largest group is below the party size goes last (strongly de-prioritized, not removed)
      -- item 81: or the space the request asks for (private room / outdoor area, only while that capability is declared) is too small
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size < v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity < v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity < v_req_party))) as k_deprio,
      -- a business that explicitly says it offers this occasion is routed the request first
      (v_req_occasion is not null and v_req_occasion = any(e.offered_occasions)) as k_occ,
      -- a business that serves the exact requested tag (a coffee shop for a coffee request) goes ahead of group-only matches
      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) as k_exact,
      -- item 80: a declared largest group that covers the party goes ahead of an unknown one
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size >= v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity >= v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity >= v_req_party))) as k_fits,
      -- item 88: a business that declared every dietary need of the request goes ahead of one that did not say
      (cardinality(coalesce(v_req_dietary, '{}')) > 0 and coalesce(e.dietary_options, '{}') @> v_req_dietary) as k_diet,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) as k_overlap,
      -- item 116 check 6: the request clearly matches something the business said it wants more of (rank only, never eligibility)
      public._business_wants_request(e.id, request_id_param) as k_want,
      (r.total_opportunities is not null and r.total_opportunities >= 5) as k_established
    from near e
    left join reputation r on r.partner_id = e.id
    where e.cat_ok and not e.declines and not e.closed_then and not e.below_min and e.distance_miles <= radius_miles_param
  ),
  ranked as (
    select s.*, row_number() over (order by
      s.k_deprio asc, s.k_occ desc, s.k_exact desc, s.k_fits desc, s.k_diet desc, s.k_overlap desc, s.k_want desc, s.k_established desc,
      s.completion_rate desc nulls last, s.distance_miles asc, s.id asc) as rn
    from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'distance', round(n.distance_miles::numeric, 2), 'rn', k.rn,
      'reasons', array(select x from unnest(array[
          case when n.distance_miles > radius_miles_param then 'outside_geo_range' end,
          case when not n.cat_ok then 'wrong_category' end,
          case when n.declines and (n.other_conflict or not n.cap_small) then 'restriction_conflict' end,
          case when n.declines and n.cap_small then 'capacity_too_small' end,
          case when n.closed_then then 'unavailable' end,  -- the audit's existing code for this
          case when n.below_min then 'below_minimum_spend' end,
          case when k.rn > 10 then 'below_routing_cutoff' end]) x where x is not null),
      'signals', array(select x from unnest(array[
          case when k.k_occ then 'occasion_offered' end,
          case when k.k_exact then 'exact_tag' end,
          case when k.k_fits then 'group_size_fits' end,
          case when k.k_deprio then 'deprioritized_size' end,
          case when k.k_diet then 'dietary_all_declared' end,
          case when k.k_overlap > 0 then 'attribute_match' end,
          case when k.k_want then 'wants_more' end,
          case when k.k_established then 'established_record' end]) x where x is not null),
      'sort_key', case when k.id is not null then jsonb_build_object(
          'deprioritized_size', k.k_deprio, 'occasion_offered', k.k_occ, 'exact_tag', k.k_exact, 'group_size_fits', k.k_fits,
          'dietary_all_declared', k.k_diet, 'attribute_overlap', k.k_overlap, 'wants_more', k.k_want, 'established_record', k.k_established,
          'completion_rate', k.completion_rate, 'distance_miles', round(k.distance_miles::numeric, 2)) end,
      'in_range', n.distance_miles <= radius_miles_param) order by k.rn nulls last, n.distance_miles), '[]'::jsonb)
  into v_cands
  from near n left join ranked k on k.id = n.id;

  perform set_config('app.routing_path', 'fanout', true);
  for v_row in
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, (c->>'id')::uuid
    from jsonb_array_elements(v_cands) c
    where (c->>'rn')::int <= 10
    order by (c->>'rn')::int
    returning id, partner_id
  loop
    v_notified_count := v_notified_count + 1;

    -- Item 125: one BUSINESS_REQUEST_SENT per business reached; the notification layer decides urgent push vs digest.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_row.id,
      (select requester_id from business_requests where id = request_id_param), 'fanout',
      jsonb_build_object('request_id', request_id_param, 'partner_id', v_row.partner_id, 'offer_id', v_row.id, 'directed', false),
      'BUSINESS_REQUEST_SENT:' || v_row.id);
  end loop;
  perform set_config('app.routing_path', '', true);

  -- The audit: never blocks routing. A failure is recorded and routing continues unchanged.
  begin
    insert into routing_decisions (request_id, path, rules_version, request_radius_miles, consideration_radius_miles,
                                   request_snapshot, considered_count, in_range_count, eligible_count, chosen_count)
    values (request_id_param, 'fanout', _routing_rules_version('fanout'), radius_miles_param, v_consider,
            _routing_request_snapshot(request_id_param) || jsonb_build_object(
              'category_filter', category_filter_param, 'major_filter', business_major_filter_param),
            jsonb_array_length(v_cands),
            (select count(*) from jsonb_array_elements(v_cands) c where (c->>'in_range')::boolean),
            (select count(*) from jsonb_array_elements(v_cands) c where c->>'rn' is not null),
            v_notified_count)
    returning id into v_decision;
    insert into routing_candidates (decision_id, partner_id, outcome, rank, primary_reason, reason_codes, signals, sort_key, distance_miles)
    select v_decision, (c->>'id')::uuid,
           case when (c->>'rn')::int <= 10 then 'chosen' else 'excluded' end,
           (c->>'rn')::int,
           case when (c->>'rn')::int <= 10 then null else c->'reasons'->>0 end,
           case when (c->>'rn')::int <= 10 then '{}'::text[] else array(select jsonb_array_elements_text(c->'reasons')) end,
           array(select jsonb_array_elements_text(c->'signals')),
           c->'sort_key', (c->>'distance')::numeric
    from jsonb_array_elements(v_cands) c;
  exception when others then
    perform _routing_record_failure(request_id_param, 'fanout', sqlerrm);
  end;

  return v_notified_count;
end;
$function$;

-- _match_request_to_availability_core (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._match_request_to_availability_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, preferred_availability_id_param uuid DEFAULT NULL::uuid, party_size_param integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_availability_id_param is not null then
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    where ba.id = preferred_availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
      values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id),
          (select requester_id from business_requests where id = request_id_param), 'match_availability',
          jsonb_build_object('request_id', request_id_param, 'partner_id', v_preferred.partner_id, 'availability_id', v_preferred.id),
          'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id));
      end if;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_availability',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_avail.partner_id, 'availability_id', v_avail.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id));
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4). Priority order, now with the
  -- real party-size feasibility case inserted between the two existing
  -- capacity-adjacent reasons: an explicit category mismatch is still the
  -- most legible reason; then zero remaining capacity; then a real but
  -- insufficient remaining capacity for the requester's own party size;
  -- then, by elimination, a date/time overlap failure.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    ba.partner_id,
    'availability',
    case
      when category_param is not null and ba.category is not null and ba.category <> category_param then 'category_mismatch'
      when not (ba.remaining_capacity is null or ba.remaining_capacity > 0) then 'zero_capacity'
      when party_size_param is not null and ba.remaining_capacity is not null and ba.remaining_capacity < party_size_param then 'insufficient_capacity'
      else 'date_or_time_mismatch'
    end,
    ba.id
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where ba.status = 'active'
  and ba.ends_at > now()
  and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= least(radius_miles_param, ba.radius_miles)
  and not (
    (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (party_size_param is null or ba.remaining_capacity is null or ba.remaining_capacity >= party_size_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and (date_param is null or date_param between ba.starts_at::date and ba.ends_at::date)
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
  )
  on conflict (request_id, partner_id, availability_id) where source = 'availability' do nothing;

  return v_new_count;
end;
$function$;

-- _match_request_to_package_core (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._match_request_to_package_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, occasion_param text, party_size_param integer, date_param date, preferred_package_id_param uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_pkg record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  v_offer_price numeric;
  v_price_is_per_person boolean;
  i integer;
begin
  if occasion_param is null then
    return 0;
  end if;

  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_package_id_param is not null then
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
    where bop.id = preferred_package_id_param
    and bop.active = true
    and bop.occasion_type = occasion_param
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      v_offer_price := case
        when v_preferred.price_per_person is not null and party_size_param is not null
          then v_preferred.price_per_person * party_size_param
        else v_preferred.price_per_person
      end;
      -- Genuinely per-person only when a real rate exists AND it could NOT
      -- be multiplied into a total (party size unknown) -- the exact other
      -- half of the case expression directly above, never re-derived
      -- separately so the two can't drift apart.
      v_price_is_per_person := (v_preferred.price_per_person is not null and party_size_param is null);

      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (
        request_id, partner_id, offer_type, offer_description, offer_title, included_items,
        offer_price, price_is_per_person, package_id, status, responded_at
      )
      values (
        request_id_param, v_preferred.partner_id, 'standard',
        v_preferred.name || coalesce(': ' || v_preferred.description, ''),
        v_preferred.name, v_preferred.included_items,
        v_offer_price, v_price_is_per_person, v_preferred.id, 'offered', now()
      )
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_title = excluded.offer_title, included_items = excluded.included_items,
            offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
            package_id = excluded.package_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id),
          (select requester_id from business_requests where id = request_id_param), 'match_package',
          jsonb_build_object('request_id', request_id_param, 'partner_id', v_preferred.partner_id, 'package_id', v_preferred.id),
          'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id));
      end if;
    end if;
  end if;

  for v_pkg in
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
    where bop.active = true
    and bop.occasion_type = occasion_param
    and (preferred_package_id_param is null or bop.id != preferred_package_id_param)
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and (
      date_param is null or bop.available_days is null
      or extract(dow from date_param)::smallint = any(bop.available_days)
    )
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by bop.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_pkg.partner_id
    ) into v_already_offered;

    v_offer_price := case
      when v_pkg.price_per_person is not null and party_size_param is not null
        then v_pkg.price_per_person * party_size_param
      else v_pkg.price_per_person
    end;
    v_price_is_per_person := (v_pkg.price_per_person is not null and party_size_param is null);

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_description, offer_title, included_items,
      offer_price, price_is_per_person, package_id, status, responded_at
    )
    values (
      request_id_param, v_pkg.partner_id, 'standard',
      v_pkg.name || coalesce(': ' || v_pkg.description, ''),
      v_pkg.name, v_pkg.included_items,
      v_offer_price, v_price_is_per_person, v_pkg.id, 'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_title = excluded.offer_title, included_items = excluded.included_items,
          offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
          package_id = excluded.package_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_pkg.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_package',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_pkg.partner_id, 'package_id', v_pkg.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_pkg.partner_id));
    end if;
  end loop;

  return v_new_count;
end;
$function$;

-- _match_request_to_policy_core (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._match_request_to_policy_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, date into v_raw_text, v_request_date from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
      and not public._business_closed_for_request(p.id, request_id_param)
    left join reputation r on r.partner_id = bfp.partner_id
    where bfp.active = true
    and bfp.auto_accept_party_size_max is not null
    and p.latitude is not null and p.longitude is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bfp.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_policy',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  -- Missed-match instrumentation: priority order stays the same reasoning
  -- as before -- can't auto-accept at all, then party size, then hours,
  -- then active days (the new predicate, inserted before weather so
  -- weather stays the real catch-all it already was), and by elimination
  -- weather is the only real predicate left once the first four all pass.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    bfp.partner_id,
    'policy',
    case
      when bfp.auto_accept_party_size_max is null then 'no_auto_accept'
      when not (
        (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
        and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
        and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
      ) then 'party_size_out_of_range'
      when public._business_closed_for_request(bfp.partner_id, request_id_param) then 'hours_mismatch'  -- item 116: known closed then
      when not (
        bfp.active_hours_start is null or bfp.active_hours_end is null
        or time_window_start_param is null or time_window_end_param is null
        or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
      ) then 'hours_mismatch'
      when not (
        bfp.active_days is null or v_request_date is null
        or extract(dow from v_request_date)::smallint = any(bfp.active_days)
      ) then 'active_days_mismatch'
      else 'weather_unfavorable'
    end,
    null
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where bfp.active = true
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  and not (
    bfp.auto_accept_party_size_max is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and not public._business_closed_for_request(bfp.partner_id, request_id_param)
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

-- _notify_other_plan_participants (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._notify_other_plan_participants(request_id_param uuid, exclude_user_id uuid, notif_type text, title_text text, body_text text, extra_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary_id uuid;
  v_plan_id uuid;
  v_uid uuid;
begin
  select coalesce(parent_request_id, id) into v_primary_id
  from business_requests where id = request_id_param;
  if v_primary_id is null then
    return;
  end if;

  select p.id into v_plan_id from plans p
  where p.resulting_business_request_id = v_primary_id
  order by p.created_at desc limit 1;
  if v_plan_id is null then
    return;
  end if;


  for v_uid in
    select distinct uid from (
      select created_by as uid from plans where id = v_plan_id
      union
      select user_id from plan_organizers where plan_id = v_plan_id
      union
      select gpp.user_id
      from group_plan_participants gpp
      where gpp.status = 'accepted'
        and gpp.proposal_id in (
          select gpp2.proposal_id from group_plan_participants gpp2
          where gpp2.source_request_id = v_primary_id
          union
          select br.group_plan_id from business_requests br
          where br.id = v_primary_id and br.group_plan_id is not null
        )
    ) x
    where uid is not null and uid is distinct from exclude_user_id
  loop
    continue when not coalesce((select notify_planning from profiles where id = v_uid), true);
    -- Item 125: through the one sender.
    perform public._send_push(v_uid, title_text, body_text,
      jsonb_build_object('type', notif_type, 'request_id', v_primary_id) || extra_data);
  end loop;
end;
$function$;

-- _route_gathering_to_partner_core (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._route_gathering_to_partner_core(gathering_id_param uuid, partner_id_param uuid, notify_param boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g record;
  v_request_id uuid;
  v_party integer;
  v_expires timestamptz;
  v_offer_id uuid;
  v_profile uuid;
  v_local_date date;
  v_local_time time;
begin
  select id, host_id, scheduled_at, precise_lat, precise_lng, interest_tag into v_g
  from gatherings where id = gathering_id_param;
  if v_g.id is null or v_g.precise_lat is null or v_g.precise_lng is null or v_g.scheduled_at < now() then
    return null;
  end if;
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    return null;
  end if;

  select id into v_request_id from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc limit 1;

  if v_request_id is null then
    v_party := public._gathering_party_size(gathering_id_param);
    select local_date, local_time into v_local_date, v_local_time from public._gathering_local_when(v_g.scheduled_at, v_g.host_id);
    v_expires := least(v_g.scheduled_at, now() + interval '30 days');
    if v_expires < now() + interval '1 hour' then v_expires := now() + interval '1 hour'; end if;
    insert into business_requests (
      requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude,
      radius_miles, expires_at, gathering_id, attributes
    ) values (
      v_g.host_id,
      case when v_g.interest_tag is not null then 'A ' || v_g.interest_tag || ' gathering looking for a place to go'
           else 'A gathering looking for a place to go' end,
      v_g.interest_tag, v_party, v_local_date, v_local_time, v_g.precise_lat, v_g.precise_lng,
      15, v_expires, gathering_id_param, public._gathering_request_attributes(gathering_id_param)
    ) returning id into v_request_id;
  end if;

  insert into business_request_offers (request_id, partner_id, is_directed)
  values (v_request_id, partner_id_param, true)
  on conflict (request_id, partner_id) do update
    set is_directed = true
    where business_request_offers.is_directed = false and business_request_offers.status = 'pending'
  returning id into v_offer_id;

  if v_offer_id is not null and notify_param then
    -- Item 125: the gathering's host asked this one business.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_offer_id, v_g.host_id, 'route_gathering_to_partner',
      jsonb_build_object('request_id', v_request_id, 'partner_id', partner_id_param, 'offer_id', v_offer_id,
                         'gathering_id', gathering_id_param, 'directed', true),
      'BUSINESS_REQUEST_SENT:' || v_offer_id || ':directed');
  end if;

  return v_request_id;
end;
$function$;

-- _route_request_to_partner_core (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public._route_request_to_partner_core(request_id_param uuid, partner_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer_id uuid;
  v_profile uuid;
begin
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    raise exception 'That business could not be found';
  end if;
  insert into business_request_offers (request_id, partner_id, is_directed)
  values (request_id_param, partner_id_param, true)
  on conflict (request_id, partner_id) do nothing
  returning id into v_offer_id;
  if v_offer_id is not null then
    -- Item 125: a request addressed to this one business.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_offer_id,
      (select requester_id from business_requests where id = request_id_param), 'route_request_to_partner',
      jsonb_build_object('request_id', request_id_param, 'partner_id', partner_id_param, 'offer_id', v_offer_id, 'directed', true),
      'BUSINESS_REQUEST_SENT:' || v_offer_id || ':directed');
  end if;
  return v_offer_id;
end;
$function$;

-- accept_business_offer (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_reservation_id uuid;
  v_managing_profiles uuid[];
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_consumer_title text;
  v_consumer_body text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id <> auth.uid() then
    raise exception 'You do not own this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now()
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  returning id into v_reservation_id;

  -- Real, honest routing: a payable Stripe PaymentIntent can only follow
  -- when there's a real price AND the business has genuinely finished
  -- Connect onboarding (stripe_charges_enabled) -- otherwise this stays
  -- exactly the pre-Stripe 'not_required' state, never a fabricated
  -- pending charge nothing downstream can actually collect.
  select stripe_charges_enabled into v_stripe_ready
  from brand_partners where id = v_offer.partner_id;

  if v_offer.offer_price is not null and coalesce(v_stripe_ready, false) then
    v_payment_status := 'pending';
    v_payment_provider := 'stripe';
  else
    v_payment_status := 'not_required';
    v_payment_provider := null;
  end if;

  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider)
  values (v_reservation_id, v_payment_status, v_offer.offer_price, 'usd', auth.uid(), v_payment_provider);

  -- Item 125: the accept is an event; the notification layer tells the business, the customer and the rest of the plan.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'accept_business_offer',
    jsonb_build_object('request_id', v_request.id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$;

-- admin_review_business_content_screening (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := coalesce(nullif(v_row.content_snapshot->>'startsAt', '')::timestamptz, now());
    v_ends_at := case
      when nullif(v_row.content_snapshot->>'endsAt', '') is not null then (v_row.content_snapshot->>'endsAt')::timestamptz
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;
    if v_ends_at <= now() then
      raise exception 'This availability window has already passed -- it could not be published.';
    end if;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components, discount_pct
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      ),
      nullif(v_row.content_snapshot->>'discountPct', '')::numeric
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    if nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz <= now() then
      raise exception 'This offer''s end time has already passed -- it could not be published.';
    end if;
    v_offer_title := nullif(trim(coalesce(v_row.content_snapshot->>'offerTitle', '')), '');

    -- Same trim + blank-filter discipline as submit_business_offer/
    -- create_occasion_package -- never a second, laxer validation rule
    -- for the identical real shape just because it arrived via a
    -- different write path (found live via Test 4 below: an earlier
    -- draft of this branch skipped the filter and let a blank jsonb
    -- array entry survive as a literal empty-string item).
    select array_agg(trim(item)) into v_items
    from jsonb_array_elements_text(coalesce(v_row.content_snapshot->'includedItems', '[]'::jsonb)) as item
    where length(trim(item)) > 0;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_title = v_offer_title,
        included_items = coalesce(v_items, '{}'::text[]),
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        price_is_per_person = coalesce((v_row.content_snapshot->>'priceIsPerPerson')::boolean, false),
        discount_pct = nullif(v_row.content_snapshot->>'discountPct', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        media_poster_path = case when v_row.content_snapshot->>'mediaType' = 'video' then nullif(v_row.content_snapshot->>'posterPath', '') else null end,
        redemption_instructions = nullif(trim(coalesce(v_row.content_snapshot->>'redemptionInstructions', '')), ''),
        creative_id = nullif(v_row.content_snapshot->>'creativeId', '')::uuid,
        valid_until = nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz,
        available_from = nullif(v_row.content_snapshot->>'availableFrom', '')::time,
        available_until = nullif(v_row.content_snapshot->>'availableUntil', '')::time,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    -- Item 125: the same BUSINESS_OFFER_SENT event as a direct reply.
    perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', o.id, null,
      'admin_review_business_content_screening',
      jsonb_build_object('request_id', o.request_id, 'partner_id', o.partner_id, 'offer_id', o.id),
      'BUSINESS_OFFER_SENT:' || o.id)
    from business_request_offers o
    where o.request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid and o.partner_id = v_row.partner_id;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;

-- invite_friend_to_gathering (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inviter_name text;
  v_gathering_title text;
  v_gathering_host_id uuid;
  v_women_only boolean;
  v_friend_gender text;
  v_is_friend boolean;
  v_is_blocked boolean;
  v_wants_notif boolean;
  v_invite_id uuid;
begin
  if not coalesce((select allow_attendee_invites from gatherings where id = gathering_id_param), true)
     and auth.uid() is distinct from (select host_id from gatherings where id = gathering_id_param) then
    raise exception 'The host has turned off invitations for this gathering.';
  end if;

  select exists(
    select 1 from friendships
    where status = 'accepted'
    and ((user_a = auth.uid() and user_b = friend_id_param) or (user_a = friend_id_param and user_b = auth.uid()))
  ) into v_is_friend;
  if not v_is_friend then
    raise exception 'You can only invite accepted friends';
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = auth.uid())
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited';
  end if;

  select host_id, title, women_only into v_gathering_host_id, v_gathering_title, v_women_only from gatherings where id = gathering_id_param;

  if v_women_only then
    select gender into v_friend_gender from profiles where id = friend_id_param;
    if lower(coalesce(v_friend_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = v_gathering_host_id and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = v_gathering_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited to this gathering';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), friend_id_param, 'gathering', gathering_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing
  returning id into v_invite_id;

  -- Item 125: the invitation is an event; the notification layer decides the push. An invite that was already
  -- pending creates no new invitation, so nothing is sent again.
  if v_invite_id is not null then
    perform public._emit_event('INVITATION_SENT', 'social_invite', v_invite_id, auth.uid(), 'invite_friend_to_gathering',
      jsonb_build_object('invite_id', v_invite_id, 'gathering_id', gathering_id_param, 'invitee_id', friend_id_param),
      'INVITATION_SENT:' || v_invite_id);
  end if;
end;
$function$;

-- submit_business_offer (unused service-key read left by 20270247 removed)
CREATE OR REPLACE FUNCTION public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, experience_id_param uuid DEFAULT NULL::uuid, media_path_param text DEFAULT NULL::text, media_type_param text DEFAULT NULL::text, offer_title_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], price_is_per_person_param boolean DEFAULT false, discount_pct_param numeric DEFAULT NULL::numeric, redemption_instructions_param text DEFAULT NULL::text, media_poster_path_param text DEFAULT NULL::text, creative_id_param uuid DEFAULT NULL::uuid, valid_until_param timestamp with time zone DEFAULT NULL::timestamp with time zone, available_from_param time without time zone DEFAULT NULL::time without time zone, available_until_param time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_request_expires_at timestamptz;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_req_category text;
  v_req_gathering uuid;
  v_offer_title text;
  v_creative record;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select status, requester_id, raw_text, expires_at into v_request_status, v_requester_id, v_raw_text, v_request_expires_at
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  -- The hourly sweep flips status; the deadline itself is authoritative the moment it passes.
  if v_request_expires_at is not null and v_request_expires_at <= now() then
    raise exception 'This request has expired.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;

  -- A saved creative REPLACES any media passed: its file and poster come from the library row (already screened).
  if creative_id_param is not null then
    select * into v_creative from business_creatives
     where id = creative_id_param and partner_id = v_partner_id and archived_at is null;
    if not found then raise exception 'That saved creative is not available.'; end if;
    media_path_param := v_creative.media_path;
    media_type_param := v_creative.media_type;
    media_poster_path_param := v_creative.poster_path;
  end if;
  if valid_until_param is not null and (valid_until_param <= now() or valid_until_param > now() + interval '30 days') then
    raise exception 'Pick an end time that is later than now (within 30 days).';
  end if;
  -- "Available 6:00-8:00 PM": the owner's own time-of-day window for when this offer can be used, on the day the visit
  -- is for (the accepted alternative time's day, else the request's date). Both ends or neither; same-day only.
  if (available_from_param is null) <> (available_until_param is null) then
    raise exception 'Set both a start and an end for the available window, or neither.';
  end if;
  if available_from_param is not null and available_until_param <= available_from_param then
    raise exception 'The available window must end after it starts.';
  end if;
  if redemption_instructions_param is not null and length(redemption_instructions_param) > 500 then
    raise exception 'Redemption instructions are too long.';
  end if;
  -- A video offer must carry a preview image (the frame Nearby screened); an image offer needs none.
  if media_type_param = 'video' and media_poster_path_param is null then
    raise exception 'A video needs a preview image.';
  end if;
  -- Media must live in this business's own folder of the offer-media bucket.
  if media_path_param is not null and media_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;
  if media_poster_path_param is not null and media_poster_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;

  v_offer_title := nullif(trim(coalesce(offer_title_param, '')), '');

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_title = v_offer_title,
      included_items = coalesce(v_items, '{}'),
      offer_price = offer_price_param,
      price_is_per_person = coalesce(price_is_per_person_param, false),
      discount_pct = discount_pct_param,
      proposed_time = proposed_time_param,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      media_poster_path = case when media_type_param = 'video' then media_poster_path_param else null end,
      redemption_instructions = nullif(trim(coalesce(redemption_instructions_param, '')), ''),
      creative_id = creative_id_param,
      valid_until = valid_until_param,
      available_from = available_from_param,
      available_until = available_until_param,
      responded_at = now()
  where id = v_row.id;

  -- Item 125: the reply is an event; the notification layer tells the customer (wording from _business_reply_push).
  perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', v_row.id, auth.uid(), 'submit_business_offer',
    jsonb_build_object('request_id', request_id_param, 'partner_id', v_partner_id, 'offer_id', v_row.id),
    'BUSINESS_OFFER_SENT:' || v_row.id);

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$;
