-- Fixes for the 3 real, confirmed defects found by the Aug 15 2026
-- "Full-System Connectivity & Integration Audit" (PRODUCT_AUDIT/
-- CONNECTIVITY_AUDIT_2026-08-15.md, Domain C / connectivity_domain_C_
-- group_merge.md, Findings C1/C2/C3). All three are database/RPC-layer
-- only -- per the audit's own analysis, no frontend change is needed for
-- any of them, since the existing UI render gates on both
-- BusinessRequestDetailScreen.js and BusinessDashboardScreen.js already
-- correctly handle an 'expired' offer and an 'open' vs. non-'open'
-- parent request; they just never received the state transition that
-- would have made them fire.

-- ---- Finding C1: confirm_group_plan doesn't cascade the merge onto the
-- participants' own already-generated business_request_offers, leaving
-- pending/offered rows permanently orphaned (a blank row on the business
-- dashboard; a live but always-server-rejected "Accept This Offer" button
-- next to the correct "this became a group plan" banner). Fix mirrors
-- cancel_business_request's own adjacent-line pattern exactly: cascade to
-- child offers in the same statement block that closes the parent
-- request, just as every other "a request stops being open" path in this
-- schema already does.
create or replace function public.confirm_group_plan(proposal_id_param uuid, exclude_user_ids_param uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
  v_final_party_size integer := 0;
  v_final_count integer := 0;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_count integer;
  v_lat double precision;
  v_lng double precision;
  v_notify_row record;
  service_key text;
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
    radius_miles, expires_at, group_plan_id
  ) values (
    v_proposal.initiator_id,
    'Group plan: ' || v_proposal.category || ' for ' || v_final_party_size || ' people',
    v_proposal.category, v_final_party_size, v_proposal.agreed_budget_max,
    v_proposal.date, v_proposal.time_window_start, v_proposal.time_window_end,
    v_lat, v_lng, v_proposal.radius_miles, v_expires_at, proposal_id_param
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

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null then
    for v_notify_row in
      select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted' and user_id <> v_proposal.initiator_id
    loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_notify_row.user_id,
          'title', 'Your group plan is live!',
          'body', 'Your ' || v_proposal.category || ' group plan was sent to nearby businesses.',
          'data', jsonb_build_object('type', 'group_plan_confirmed', 'proposal_id', proposal_id_param, 'request_id', v_request_id)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true, 'requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_final_party_size);
end;
$function$;

revoke all on function public.confirm_group_plan(uuid, uuid[]) from public, anon;
grant execute on function public.confirm_group_plan(uuid, uuid[]) to authenticated;

-- ---- Finding C2: confirm_group_plan_offer had no row lock on its
-- quorum-counting path -- the exact "last person to act triggers an
-- irreversible transaction" race this codebase's own Aug 15 architecture-
-- hardening pass explicitly closed for accept_business_offer/
-- approve_gathering_interest, left open here only because this function
-- was added the same day but in a different migration. Fix: lock
-- group_plan_proposals and the specific offer row for update at the top,
-- exactly like _accept_business_offer_internal already does -- this
-- serializes concurrent confirmations from different participants on the
-- same offer/proposal, so the count read is always the true, committed
-- count.
create or replace function public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
  v_offer record;
  v_participant record;
  v_required_count integer;
  v_confirmed_count integer;
  v_accept_result jsonb;
  v_notify_row record;
  service_key text;
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

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = auth.uid() and status = 'accepted';
  if v_participant is null then
    raise exception 'You are not an active participant in this group plan.';
  end if;

  insert into group_plan_offer_confirmations (proposal_id, offer_id, user_id)
  values (proposal_id_param, offer_id_param, auth.uid())
  on conflict (offer_id, user_id) do nothing;

  select count(*) into v_required_count from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted';
  select count(*) into v_confirmed_count from group_plan_offer_confirmations where proposal_id = proposal_id_param and offer_id = offer_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_confirmed_count < v_required_count then
    if service_key is not null then
      for v_notify_row in
        select gpp.user_id from group_plan_participants gpp
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted' and gpp.user_id <> auth.uid()
        and not exists (select 1 from group_plan_offer_confirmations c where c.offer_id = offer_id_param and c.user_id = gpp.user_id)
      loop
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_notify_row.user_id,
            'title', 'Confirm your group plan offer',
            'body', 'Someone in your group confirmed a business offer -- confirm your spot too.',
            'data', jsonb_build_object('type', 'group_plan_offer_pending', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param)
          )
        );
      end loop;
    end if;
    return jsonb_build_object('success', true, 'allConfirmed', false, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count);
  end if;

  v_accept_result := public._accept_business_offer_internal(offer_id_param);

  if service_key is not null then
    for v_notify_row in
      select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted' and user_id <> auth.uid()
    loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_notify_row.user_id,
          'title', 'Group plan reservation confirmed!',
          'body', 'Everyone confirmed -- your group plan reservation is locked in.',
          'data', jsonb_build_object('type', 'group_plan_reservation_confirmed', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true, 'allConfirmed', true, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count) || v_accept_result;
end;
$function$;

revoke all on function public.confirm_group_plan_offer(uuid, uuid) from public, anon;
grant execute on function public.confirm_group_plan_offer(uuid, uuid) to authenticated;

-- ---- Finding C3: no exclusivity between two concurrently-pending group
-- plan proposals that both invite the same person's still-open request --
-- a person's real party size/capacity could be double-committed across
-- two unrelated group plans. Fix, matching this schema's existing
-- preference for a real constraint over app-level discipline alone: a
-- partial unique index that makes it structurally impossible for the
-- same source_request_id to be an active (invited or accepted)
-- participant in more than one group plan at a time.
--
-- Two real, pre-existing gaps had to be closed first or this index would
-- have introduced a regression: neither cancel_group_plan nor
-- expire_stale_business_requests() ever reset a still-invited/accepted
-- participant row back to a terminal status when their proposal died --
-- so a cancelled or expired proposal's participants would otherwise stay
-- permanently locked out of ever joining a future group plan. Both are
-- fixed below, in the same migration, before the index is created.
update group_plan_participants gpp
set status = 'left'
from group_plan_proposals gpr
where gpr.id = gpp.proposal_id
and gpr.status in ('cancelled', 'expired')
and gpp.status in ('invited', 'accepted');

create unique index group_plan_participants_active_source_request_idx
  on group_plan_participants (source_request_id)
  where status in ('invited', 'accepted');

create or replace function public.cancel_group_plan(proposal_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can cancel it.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan can no longer be cancelled.';
  end if;

  update group_plan_proposals set status = 'cancelled', cancelled_at = now() where id = proposal_id_param;

  -- Finding C3's other real half: free up every participant's
  -- source_request_id (this migration's own new partial unique index)
  -- now that this proposal is dead, so they can be invited into a future
  -- group plan. Individual source requests themselves were never touched
  -- pre-confirmation -- nothing to restore there, they're still exactly
  -- as they were.
  update group_plan_participants
  set status = 'left'
  where proposal_id = proposal_id_param and status in ('invited', 'accepted');

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_group_plan(uuid) from public, anon;
grant execute on function public.cancel_group_plan(uuid) to authenticated;

create or replace function public.expire_stale_business_requests()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update business_request_offers
  set status = 'expired'
  where status in ('pending', 'offered')
  and request_id in (
    select id from business_requests where status = 'open' and expires_at < now()
  );

  update business_requests
  set status = 'expired'
  where status = 'open' and expires_at < now();

  update business_request_offers
  set status = 'expired'
  where status in ('pending', 'offered')
  and availability_id in (
    select id from business_availability where status = 'active' and ends_at < now()
  );

  update business_availability
  set status = 'expired'
  where status = 'active' and ends_at < now();

  -- Finding C3's other real half, same reasoning as cancel_group_plan
  -- above: free a stale, never-decided proposal's own participants
  -- (this migration's new partial unique index) in the same sweep that
  -- expires the proposal itself, not a separate pass.
  update group_plan_participants
  set status = 'left'
  where status in ('invited', 'accepted')
  and proposal_id in (
    select id from group_plan_proposals where status = 'pending' and expires_at < now()
  );

  update group_plan_proposals
  set status = 'expired'
  where status = 'pending' and expires_at < now();
end;
$function$;

revoke all on function public.expire_stale_business_requests() from public, anon, authenticated;

-- propose_group_plan re-pointed: both participant inserts (the
-- initiator's own auto-accepted row, and each invitee's row) now need to
-- handle the new partial unique index's conflict. The initiator's own
-- insert re-raises a clear, honest error (without it there's no real
-- proposal at all); an invitee's insert is caught and silently skipped,
-- matching this function's own already-established convention for any
-- other invitee whose request changed between fetch and submit (a stale
-- or spoofed client-supplied id is silently skipped, never trusted or
-- surfaced as a hard error for the whole proposal).
create or replace function public.propose_group_plan(
  source_request_id_param uuid,
  invitee_source_request_ids_param uuid[]
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      -- Not a real, still-open, genuinely-connected, same-category
      -- request -- silently skipped rather than failing the whole
      -- proposal. The client only ever sources this list from
      -- get_connected_open_business_requests scoped to this same
      -- category, so a mismatch here means the world changed between
      -- fetch and submit (e.g. it just got fulfilled), not an abuse
      -- attempt worth surfacing as a hard error.
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
