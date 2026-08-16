-- Closes four real, previously-disclosed-but-left-alone gaps from the Aug 16 2026
-- acceptance audit / RLS resweep, all documented in CLAUDE.md as "flagged, not fixed"
-- rather than silently forgotten. Each is independent; grouped into one migration
-- since all four are small, targeted fixes landing the same day.

-- 1. join_gathering's idempotent-return path (a repeat call for an already-active
-- request) always returned match_id: null, even when a real match already existed
-- from the original join. Cosmetic only (the match itself was always created
-- correctly) but worth closing since a client retry/double-tap now gets the real id
-- back instead of a false null.
create or replace function public.join_gathering(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_is_public boolean;
  v_women_only boolean;
  v_capacity integer;
  v_visibility text;
  v_user_id uuid := auth.uid();
  v_gender text;
  v_is_blocked boolean;
  v_has_invite boolean;
  v_approved_count integer;
  v_status text;
  v_new_match_id uuid;
  v_row_count integer;
begin
  -- Locks the gathering row so two concurrent joiners can't both read
  -- "one spot left" and both get approved.
  select host_id, is_public, women_only, capacity, visibility
  into v_host_id, v_is_public, v_women_only, v_capacity, v_visibility
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_host_id = v_user_id then
    raise exception 'Cannot express interest in your own gathering';
  end if;

  if v_visibility = 'invite_only' then
    select exists(
      select 1 from social_invites
      where invite_type = 'gathering'
        and target_id = gathering_id_param
        and invitee_id = v_user_id
        and status = 'accepted'
    ) into v_has_invite;
    if not v_has_invite then
      raise exception 'This gathering is invite-only. Ask the host for an invite.';
    end if;
  end if;

  if v_women_only then
    select gender into v_gender from profiles where id = v_user_id;
    if lower(coalesce(v_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_user_id)
    or (blocker_id = v_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot express interest in this gathering';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';

  -- At/over capacity always waitlists, regardless of public/host-approval --
  -- "no spot available" is the same fact either way. Under capacity keeps
  -- today's exact behavior: public auto-approves, host-approval stays
  -- pending for the host to review.
  if v_capacity is not null and v_approved_count >= v_capacity then
    v_status := 'waitlisted';
  elsif v_is_public then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  insert into gathering_interest (gathering_id, user_id, status)
  values (gathering_id_param, v_user_id, v_status)
  on conflict (gathering_id, user_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Already had an active request (pending/approved/waitlisted) --
    -- idempotent, return their existing status rather than erroring.
    -- If that existing status is already 'approved', a real match was
    -- already created the first time -- look it up instead of a
    -- hardcoded null, so a retried/double-tapped call reports the
    -- real match_id it already has, not a false "no match" answer.
    select status into v_status from gathering_interest
    where gathering_id = gathering_id_param and user_id = v_user_id;
    if v_status = 'approved' then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
    return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
  end if;

  if v_status = 'approved' then
    insert into matches (user_a, user_b, source_gathering_id)
    values (least(v_host_id, v_user_id), greatest(v_host_id, v_user_id), gathering_id_param)
    on conflict (user_a, user_b) do update
      set source_gathering_id = gathering_id_param
      where matches.source_gathering_id is null
    returning id into v_new_match_id;
    if v_new_match_id is null then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
  end if;

  return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
end;
$$;

-- 2. confirm_group_plan's block check only ever covered the initiator<->invitee
-- edge (propose_group_plan, respond_to_group_plan) -- propose_group_plan's own
-- hub-and-spoke design means two non-initiator participants who are both
-- connected to the initiator but blocked from each other could still end up
-- sharing a confirmed roster. Real all-pairs check, right before the roster is
-- locked in and a real shared business_requests row is created. Queries `blocks`
-- directly rather than via is_blocked() -- is_blocked() only ever answers for a
-- pair where auth.uid() is one of the two ids (a deliberate guard from the Aug 8
-- fix), so it would silently return false for a non-initiator pair and defeat
-- this exact check. A direct query is safe here since this function is
-- SECURITY DEFINER and already reads other RLS-protected tables (gatherings,
-- business_requests, etc.) the same way throughout this schema.
create or replace function public.confirm_group_plan(proposal_id_param uuid, exclude_user_ids_param uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- 3. business_partner_requests' raw admin UPDATE RLS policy predates
-- approve_business_partner_request()/deny_business_partner_request() and had
-- no status check of its own -- an admin session could bypass those RPCs'
-- pending-only double-review guard via a direct table write. Both RPCs are
-- SECURITY DEFINER (bypass RLS entirely), so tightening this policy only
-- closes the direct-write path, doesn't touch the real approve/deny flow.
drop policy if exists "Admins can update requests" on public.business_partner_requests;
create policy "Admins can update pending requests"
  on public.business_partner_requests for update
  using (
    status = 'pending'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Bonus finding while verifying the fix above: `authenticated` has never
-- actually held an UPDATE grant on this table at all (checked via
-- information_schema.role_table_grants) -- the RLS policy alone was
-- unreachable for a real admin session, GRANT is checked before RLS.
-- Meanwhile `anon` DOES hold a raw UPDATE/DELETE/INSERT/SELECT grant here,
-- the exact same stray default-privileges artifact this file's own
-- "Known conventions" section already warns about elsewhere (not currently
-- exploitable -- auth.uid() is null for anon, so both the admin-only UPDATE
-- policy and the owner-only INSERT policy already reject it -- but real
-- defense-in-depth hygiene, matching the Community Leaders section's own
-- "caught and fixed my own mistake... revoke ... from public, anon"
-- precedent). Tightened to exactly what each role legitimately needs:
-- `authenticated` submits its own request (INSERT) and reads
-- own/admin-all (SELECT) directly; every UPDATE goes through
-- approve_business_partner_request()/deny_business_partner_request(), both
-- SECURITY DEFINER and unaffected by any of this; `anon` needs nothing.
revoke all on public.business_partner_requests from anon;
revoke delete on public.business_partner_requests from authenticated;

-- 4. relationship_legacy_entries' SELECT policy (qual: true, roles: public) let
-- a raw API call select submitted_by/match_id even though the feature's own
-- client (getLegacyEntries()) deliberately never reads either column, to keep
-- the "wisdom library" genuinely anonymized. RLS filters rows, not columns, so
-- the real fix is a narrow public view exposing only the anonymized fields --
-- same "controlled surface, not the raw table" posture as this schema's own
-- SECURITY DEFINER RPCs elsewhere. The view is owned by the migration role
-- (not security_invoker), so it runs with that role's own privileges and
-- bypasses RLS to serve the safe columns regardless of the now-closed base
-- table SELECT policy -- postgres/service_role retain full table access via
-- their own bypassrls-equivalent privilege, unaffected by this change.
drop policy if exists "Anyone can read legacy entries" on public.relationship_legacy_entries;

create or replace view public.relationship_legacy_entries_public as
select id, what_surprised_us, what_almost_ended_us, what_made_us_stronger,
       what_we_wish_we_discussed_earlier, created_at
from public.relationship_legacy_entries;

grant select on public.relationship_legacy_entries_public to anon, authenticated;
