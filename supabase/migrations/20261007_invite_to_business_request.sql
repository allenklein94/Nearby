-- Item 36, chain 1 fix ("I want dinner" -> restaurants -> friends/match ->
-- availability -> plan -> reservation): today, submitting a business
-- request (AskBusinessScreen -> create_business_request) is a fully solo
-- act. The only existing way a second person ever enters a business
-- request is propose_group_plan(), and it only works when the invitee
-- ALREADY, coincidentally, has their own separate open request in the
-- same category -- by design (see that function's own header comment).
-- There was no way to deliberately name one specific already-connected
-- friend or match and invite them into a request you already submitted.
--
-- Locked design (PRODUCT_AUDIT/INTENT_ACTION_PATTERN_2026-09-11.md,
-- "Chain 1 fix -- REDESIGNED to 'invite-after-submitting'"): submission
-- stays exactly as it is today (solo, no gate, no added friction). AFTER
-- submitting, the requester can optionally invite a specific connected
-- friend or match. This reuses the EXISTING group-plan consent
-- architecture (group_plan_proposals / group_plan_participants /
-- respond_to_group_plan / confirm_group_plan) rather than inventing a
-- parallel mechanism -- verified live via pg_get_functiondef that all of
-- those are fully generic over how a group_plan_participants row was
-- created, so nothing downstream needs to change.
--
-- group_plan_participants.source_request_id is NOT NULL (every
-- participant must own a real business_requests row) -- so this function
-- auto-creates a placeholder business_requests row on the invitee's own
-- behalf, exactly like propose_group_plan's own invitees always already
-- had one, except here it's synthesized rather than pre-existing. That
-- placeholder is deliberately NEVER fanned out to businesses (no
-- _business_request_fanout/_match_request_to_availability/_match_request_to_policy
-- calls) -- it's pure bookkeeping until the invitee actually accepts and
-- the group is confirmed via the existing confirm_group_plan, which
-- creates its own new merged request and fans that out for real. If the
-- invitee never accepts, their placeholder just sits unfanned and expires
-- naturally via the existing expire_stale_business_requests() job.
create or replace function invite_to_business_request(request_id_param uuid, invitee_ids_param uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_companion_request_id uuid;
  v_expires_at timestamptz;
  v_invited_count integer := 0;
  service_key text;
  v_initiator_name text;
  v_wants_notif boolean;
begin
  select * into v_request from business_requests where id = request_id_param and requester_id = auth.uid() for update;
  if v_request is null then
    raise exception 'You do not own this request.';
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

  -- Find or create the wrapping proposal for this specific request -- a
  -- second "Invite someone" call on the same request reuses the same
  -- proposal instead of creating a duplicate one.
  select proposal_id into v_proposal_id
  from group_plan_participants
  where source_request_id = request_id_param and user_id = auth.uid();

  if v_proposal_id is null then
    v_expires_at := now() + interval '48 hours';
    insert into group_plan_proposals (initiator_id, category, date, time_window_start, time_window_end, radius_miles, expires_at)
    values (auth.uid(), v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end, v_request.radius_miles, v_expires_at)
    returning id into v_proposal_id;

    -- Rule 3 (propose_group_plan's own convention): the initiator is a
    -- real participant like everyone else, not a special row.
    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
    values (v_proposal_id, auth.uid(), request_id_param, coalesce(v_request.party_size, 1), 'accepted', now());
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_initiator_name from profiles where id = auth.uid();

  foreach v_invitee_id in array invitee_ids_param loop
    continue when v_invitee_id = auth.uid();
    continue when is_blocked(auth.uid(), v_invitee_id);

    -- Real connections only -- accepted friend or active match. Same
    -- shape as propose_group_plan's own eligibility check, just against
    -- the person directly instead of through a pre-existing request of
    -- theirs. Standing "no stranger discovery via intent" rule.
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
      values (v_proposal_id, v_invitee_id, v_companion_request_id, 1, 'invited');
      v_invited_count := v_invited_count + 1;
    exception when unique_violation then
      -- Already a participant in this proposal (invited/accepted/
      -- declined already) -- silent no-op, same posture as
      -- propose_group_plan's own duplicate handling.
      continue;
    end;

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_invitee_id,
          'title', 'You''re invited to a plan',
          'body', coalesce(v_initiator_name, 'Someone you know') || ' invited you to their ' || v_request.category || ' plan.',
          'data', jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id)
        )
      );
    end if;
  end loop;

  if v_invited_count = 0 then
    raise exception 'None of the people you picked could be invited -- they may no longer be connected.';
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'invitedCount', v_invited_count);
end;
$function$;

revoke all on function invite_to_business_request(uuid, uuid[]) from public, anon;
grant execute on function invite_to_business_request(uuid, uuid[]) to authenticated;
