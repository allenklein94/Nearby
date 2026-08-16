-- Full System Acceptance Audit, Wave 2A (see PRODUCT_AUDIT/ACCEPTANCE_AUDIT_PROGRESS.md), item
-- 7 -- "does business_requests/group_plan_* have ANY block check anywhere?" Resolved
-- definitively: no, confirmed by reading every live function body in this chain
-- (get_connected_open_business_requests, propose_group_plan, respond_to_group_plan,
-- confirm_group_plan, confirm_group_plan_offer, create_business_request,
-- _business_request_fanout, submit_business_offer, post_business_availability) -- none of them
-- reference `blocks`/`is_blocked` at all, and `blocks` has zero triggers (confirmed live), so
-- blocking someone does not remove a pre-existing accepted friendship or matches row. Net
-- effect: two people who blocked each other but still have an old accepted friendship/match row
-- could still be surfaced to each other as a Tier 2 "connected friend ask" on Home, and one
-- could propose (and the other accept) a group plan together, seeing each other's name/party
-- size in the shared roster -- a real bypass of the block, not present in dating discovery
-- (which already excludes blocked pairs via is_blocked in matches/messages RLS).
--
-- Fixed at the root (get_connected_open_business_requests, the one RPC that sources both
-- HomeScreen's Tier 2 resolver results and getGroupPlanCandidates' own invite picker) plus
-- defensive re-checks at the two write paths that consume it (propose_group_plan,
-- respond_to_group_plan) -- matching this schema's own established "never trust a stale
-- client, re-check server-side at the point of write" convention (e.g.
-- record_friend_discovery_swipe's own defensive block re-check even though its own candidate
-- RPC already filters).
--
-- Deliberately scoped to the initiator<->invitee relationship, not a full N-way check between
-- every pair of participants in a multi-person group plan -- propose_group_plan's own design is
-- already hub-and-spoke around the initiator (every invitee is checked against the initiator's
-- own connections, never against each other), so two non-initiator participants who are
-- blocked from each other but both genuinely connected to the initiator could still end up in
-- the same group plan without this fix catching it. Disclosed as a real, known residual gap,
-- not silently claimed fully closed -- solving it needs an all-pairs check across the whole
-- roster at confirm time, a larger change than this pass's scope.

CREATE OR REPLACE FUNCTION public.get_connected_open_business_requests(category_param text DEFAULT NULL::text, date_start_param date DEFAULT NULL::date, date_end_param date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, requester_id uuid, requester_display_name text, requester_photo_url text, raw_text text, category text, date date, party_size integer, match_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
    union
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from matches
    where user_a = auth.uid() or user_b = auth.uid()
  )
  select
    br.id, br.requester_id, p.display_name, p.photo_url, br.raw_text, br.category, br.date, br.party_size,
    m.id as match_id
  from business_requests br
  join connected c on c.friend_id = br.requester_id
  join profiles p on p.id = br.requester_id
  left join matches m
    on (m.user_a = auth.uid() and m.user_b = br.requester_id)
    or (m.user_a = br.requester_id and m.user_b = auth.uid())
  where br.status = 'open'
  and br.expires_at > now()
  and br.requester_id <> auth.uid()
  and p.intent_visibility = 'friends_and_matches'
  and not is_blocked(auth.uid(), br.requester_id)
  and (category_param is null or br.category = category_param)
  and (
    date_start_param is null
    or br.date is null
    or br.date between date_start_param and coalesce(date_end_param, date_start_param)
  )
  order by br.created_at desc
  limit 4;
$function$;

revoke all on function public.get_connected_open_business_requests(text, date, date) from public, anon;
grant execute on function public.get_connected_open_business_requests(text, date, date) to authenticated;

CREATE OR REPLACE FUNCTION public.propose_group_plan(source_request_id_param uuid, invitee_source_request_ids_param uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_invitee_request record;
  v_min_budget integer;
  v_max_budget integer;
  v_expires_at timestamptz;
  v_participant_count integer;
  service_key text;
  v_initiator_name text;
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

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
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
      on conflict (proposal_id, user_id) do nothing;
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

    if service_key is not null then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_invitee_request.requester_id,
          'title', 'Make this a group plan?',
          'body', coalesce(v_initiator_name, 'Someone you know') || ' wants to turn your ' || v_source.category || ' request into a shared group plan.',
          'data', jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id)
        )
      );
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

revoke all on function public.propose_group_plan(uuid, uuid[]) from public, anon;
grant execute on function public.propose_group_plan(uuid, uuid[]) to authenticated;

-- Defensive re-check: a block created between the invite being sent and
-- the invitee responding (whichever direction) should stop the response
-- from succeeding, matching this schema's "never trust a stale state,
-- re-check at the point of write" convention. Generic rejection message,
-- same posture as join_gathering's own blocked-pair rejection -- never
-- reveals which side blocked which.
CREATE OR REPLACE FUNCTION public.respond_to_group_plan(proposal_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_participant record;
  service_key text;
  v_responder_name text;
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

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_responder_name from profiles where id = auth.uid();
  if service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_proposal.initiator_id,
        'title', case when accept_param then 'Group plan accepted' else 'Group plan response' end,
        'body', coalesce(v_responder_name, 'Someone') || (case when accept_param then ' joined your group plan.' else ' can''t join your group plan.' end),
        'data', jsonb_build_object('type', 'group_plan_response', 'proposal_id', proposal_id_param)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

revoke all on function public.respond_to_group_plan(uuid, boolean) from public, anon;
grant execute on function public.respond_to_group_plan(uuid, boolean) to authenticated;
