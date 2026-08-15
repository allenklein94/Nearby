-- "Nearby V3/V4" plan, Phase D -- group intent -> a real, jointly-owned
-- business request (see CLAUDE.md's "Nearby V3/V4" plan section). Locked
-- design, given directly by the user after reviewing the open design
-- questions Phase D's own plan text flagged (consent, ownership,
-- reconciliation) -- not guessed at by this migration. Every rule below
-- maps to one of the user's own 14 numbered decisions.
--
-- Scope boundary, explicitly reaffirmed per the user's own closing note:
-- this stays entirely within the existing "no stranger discovery via
-- intent" boundary -- every participant is reached only through an
-- already-real, already-open business_requests row belonging to someone
-- the caller is genuinely connected to (accepted friendship or match),
-- the exact same connected-set definition Tier 2 / Layer 3 already use.
-- No new social-graph surface, no broader invite mechanism.

-- ---- Tables ----

-- One row per proposed (or confirmed) group plan. Deliberately NOT a
-- second copy of business_requests' own shape -- this table only holds
-- what's genuinely proposal-specific (consent state, the reconciled
-- budget range); once confirmed, the real terms live on a real
-- business_requests row like everything else in this schema, reached via
-- resulting_request_id.
create table group_plan_proposals (
  id uuid primary key default gen_random_uuid(),
  initiator_id uuid not null references profiles(id),
  category text not null,
  date date,
  time_window_start time,
  time_window_end time,
  radius_miles double precision not null default 15,
  -- Rule 6: a real range computed from real individual budget_max values
  -- at proposal time, never a silent average. null/null when nobody in
  -- the group specified a budget at all.
  proposed_budget_min integer,
  proposed_budget_max integer,
  -- Rule 6: the group's own final number, set only via an explicit
  -- set_group_plan_budget() call -- never defaulted, never silently
  -- picked from the range above.
  agreed_budget_max integer check (agreed_budget_max is null or agreed_budget_max >= 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  resulting_request_id uuid references business_requests(id),
  created_at timestamptz not null default now()
);

create index group_plan_proposals_initiator_idx on group_plan_proposals(initiator_id);
create index group_plan_proposals_resulting_request_idx on group_plan_proposals(resulting_request_id);

-- Rule 2: individual requests are never deleted or silently merged --
-- each participant's own real, pre-existing business_requests row is
-- linked here via source_request_id and stays fully intact (still
-- readable, still has its own history) right up until confirm_group_plan
-- actually flips it to 'merged'. Rule 3: the initiator is only the
-- operational submitter, not a unilateral owner -- every participant row
-- here is a first-class, independently-consenting party.
create table group_plan_participants (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references group_plan_proposals(id) on delete cascade,
  user_id uuid not null references profiles(id),
  source_request_id uuid not null references business_requests(id),
  -- Rule 5: the group's final party size is the real sum of every
  -- accepted participant's own party_size + guest_count -- never
  -- averaged, never invented.
  party_size integer not null default 1 check (party_size > 0),
  guest_count integer not null default 0 check (guest_count >= 0),
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'left')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(proposal_id, user_id)
);

create index group_plan_participants_proposal_idx on group_plan_participants(proposal_id);
create index group_plan_participants_user_idx on group_plan_participants(user_id);
create index group_plan_participants_source_request_idx on group_plan_participants(source_request_id);

-- Rule 8: a business offer on a group's shared request is accepted only
-- once every currently-accepted participant has explicitly confirmed it
-- -- one row per (offer, participant) confirmation, not a single
-- initiator click.
create table group_plan_offer_confirmations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references group_plan_proposals(id) on delete cascade,
  offer_id uuid not null references business_request_offers(id),
  user_id uuid not null references profiles(id),
  confirmed_at timestamptz not null default now(),
  unique(offer_id, user_id)
);

create index group_plan_offer_confirmations_offer_idx on group_plan_offer_confirmations(offer_id);

-- business_requests gains the two columns that link a real request back
-- to the group plan that produced (or superseded) it. 'merged' is a new,
-- additive status value -- every existing row's status is untouched.
alter table business_requests add column group_plan_id uuid references group_plan_proposals(id);
alter table business_requests add column superseded_by_group_plan_id uuid references group_plan_proposals(id);

alter table business_requests drop constraint business_requests_status_check;
alter table business_requests add constraint business_requests_status_check
  check (status = any(array['open', 'fulfilled', 'expired', 'cancelled', 'merged']));

-- ---- RLS ----

alter table group_plan_proposals enable row level security;
alter table group_plan_participants enable row level security;
alter table group_plan_offer_confirmations enable row level security;

-- Same SECURITY DEFINER-bypasses-RLS mitigation this schema already
-- established for is_blocked()/is_community_visible_to() -- a self-
-- referencing policy on group_plan_participants would otherwise need to
-- re-evaluate its own RLS while evaluating itself. The internal
-- auth.uid() = user_id_param guard matches those same functions' own
-- defensive pattern (only ever answers for the calling user, never lets
-- an authenticated caller probe an arbitrary pair).
create or replace function public.is_group_plan_participant(proposal_id_param uuid, user_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when auth.uid() <> user_id_param then false
    else exists (
      select 1 from group_plan_participants
      where proposal_id = proposal_id_param and user_id = user_id_param
    )
  end;
$function$;

revoke all on function public.is_group_plan_participant(uuid, uuid) from public, anon;
grant execute on function public.is_group_plan_participant(uuid, uuid) to authenticated;

create policy "Initiator or participants can view a group plan"
  on group_plan_proposals for select
  using (initiator_id = auth.uid() or is_group_plan_participant(id, auth.uid()));

create policy "Participants can view their group's own roster"
  on group_plan_participants for select
  using (user_id = auth.uid() or is_group_plan_participant(proposal_id, auth.uid()));

create policy "Participants can view their group's offer confirmations"
  on group_plan_offer_confirmations for select
  using (is_group_plan_participant(proposal_id, auth.uid()));

-- No client INSERT/UPDATE/DELETE policy on any of the three tables --
-- every write goes through a SECURITY DEFINER RPC below, matching this
-- schema's own established "no direct client write on a lifecycle table"
-- convention (business_requests/business_request_offers/
-- business_availability all follow the identical shape).

-- Group plan participants also need to see the real business_requests
-- row and its real offers once a proposal is confirmed -- additive SELECT
-- policies, OR'd with the existing requester-only/business-only ones
-- already on both tables, so this only ever widens who can see a group's
-- own shared request, never narrows anything.
create policy "Group plan participants can view the resulting request"
  on business_requests for select
  using (group_plan_id is not null and is_group_plan_participant(group_plan_id, auth.uid()));

create policy "Group plan participants can view offers on their request"
  on business_request_offers for select
  using (
    exists (
      select 1 from business_requests br
      where br.id = business_request_offers.request_id
      and br.group_plan_id is not null
      and is_group_plan_participant(br.group_plan_id, auth.uid())
    )
  );

-- ---- RPCs ----

-- Rule 1: explicit consent from every participant, no silent merging.
-- Rule 11: every invitee is re-validated server-side against the exact
-- same connected-set definition Tier 2/Layer 3 already use -- never
-- trusts the client's own candidate list, so a stranger can never be
-- swept into someone else's group plan even by a malformed client call.
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
  insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
  values (v_proposal_id, auth.uid(), source_request_id_param, coalesce(v_source.party_size, 1), 'accepted', now());

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

    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status)
    values (v_proposal_id, v_invitee_request.requester_id, v_invitee_id, coalesce(v_invitee_request.party_size, 1), 'invited')
    on conflict (proposal_id, user_id) do nothing;

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

-- Rule 1: each invited participant explicitly accepts or declines their
-- own row -- nobody else can respond on their behalf.
create or replace function public.respond_to_group_plan(proposal_id_param uuid, accept_param boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

-- Rule 6: the group's final budget is only ever set explicitly, and only
-- by the initiator, bounded to the real range participants' own
-- individual budgets actually support -- never silently averaged or
-- overwritten. Rule 7: changing it after someone already accepted is a
-- material change -- their consent is reset, not silently carried
-- forward onto terms they never actually agreed to.
create or replace function public.set_group_plan_budget(proposal_id_param uuid, agreed_budget_max_param integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
  v_reset_user_ids uuid[];
  v_notify_id uuid;
  service_key text;
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

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    if service_key is not null then
      foreach v_notify_id in array v_reset_user_ids loop
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_notify_id,
            'title', 'Group plan budget changed',
            'body', 'The budget for your group plan changed -- please confirm you''re still in.',
            'data', jsonb_build_object('type', 'group_plan_response', 'proposal_id', proposal_id_param)
          )
        );
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true, 'resetCount', coalesce(array_length(v_reset_user_ids, 1), 0));
end;
$function$;

revoke all on function public.set_group_plan_budget(uuid, integer) from public, anon;
grant execute on function public.set_group_plan_budget(uuid, integer) to authenticated;

-- Rule 4: once confirmed, this is the ONE real business_requests row for
-- the whole group -- fanned out exactly like a solo request, so nothing
-- downstream needs to know a group plan was ever involved. Rule 2: every
-- merged individual request transitions to 'merged', never deleted, its
-- own history intact. Rule 9: a decline doesn't kill the group -- the
-- initiator explicitly decides who's in (exclude_user_ids_param) and
-- anyone who never actually accepted is left out of the final roster,
-- never silently included.
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
  -- Individual source requests were never touched pre-confirmation --
  -- nothing to restore, they're still exactly as they were.
  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_group_plan(uuid) from public, anon;
grant execute on function public.cancel_group_plan(uuid) to authenticated;

-- Rule 10: a participant leaving after the group's real request already
-- exists is a material change -- any offer they hadn't yet confirmed
-- (via confirm_group_plan_offer, below) is cleared so remaining
-- participants can't silently coast to a reservation on a roster that no
-- longer reflects who actually said yes. Does not attempt a live
-- capacity/price re-quote from the business -- that's not this RPC's
-- job, it only ever happens for real inside _accept_business_offer_
-- internal's own existing capacity lock, same as every solo request.
create or replace function public.leave_group_plan(proposal_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
  v_participant record;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id = auth.uid() then
    raise exception 'The organizer can''t leave -- cancel the group plan instead.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = auth.uid() for update;
  if v_participant is null then
    raise exception 'You are not part of this group plan.';
  end if;
  if v_participant.status = 'left' then
    raise exception 'You have already left this group plan.';
  end if;

  update group_plan_participants set status = 'left', responded_at = coalesce(responded_at, now()) where id = v_participant.id;

  if v_proposal.status = 'confirmed' and v_proposal.resulting_request_id is not null then
    delete from group_plan_offer_confirmations where proposal_id = proposal_id_param and user_id = auth.uid();
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.leave_group_plan(uuid) from public, anon;
grant execute on function public.leave_group_plan(uuid) to authenticated;

-- Internal accept logic, shared between the solo path (accept_business_
-- offer, below) and the group path (confirm_group_plan_offer). Identical
-- to accept_business_offer's own body except it has no requester-
-- ownership check of its own -- caller authority is established by
-- whichever public RPC wraps it (either "you own this request" or "every
-- required participant has confirmed"), not by this function itself.
-- Locked down exactly like _business_request_fanout: no grants to any
-- role at all, callable only via a nested SECURITY DEFINER call from
-- within another function owned by the same role.
create or replace function public._accept_business_offer_internal(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  service_key text;
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

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_managing_profiles[i],
          'title', 'Your offer was accepted!',
          'body', 'A customer accepted your offer on "' || left(v_request.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_offer_accepted', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public._accept_business_offer_internal(uuid) from public, anon, authenticated;

-- accept_business_offer, re-pointed (CREATE OR REPLACE, same signature,
-- every other line byte-for-byte unchanged from the live, already-locked
-- version pulled fresh from production before editing) with exactly one
-- new guard: a group-plan request can never be accepted unilaterally by
-- its own requester_id (the initiator) -- only confirm_group_plan_offer,
-- once every required participant has confirmed, can accept it. Rule 8,
-- rule 11 (never expose a participant to an unexpected transaction).
create or replace function public.accept_business_offer(offer_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  service_key text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
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
  if v_request.group_plan_id is not null then
    raise exception 'This is a group plan request -- every participant needs to confirm it together.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
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

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_managing_profiles[i],
          'title', 'Your offer was accepted!',
          'body', 'A customer accepted your offer on "' || left(v_request.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_offer_accepted', 'request_id', v_request.id, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

-- Rule 8: every currently-accepted participant must explicitly confirm
-- an offer before it's actually accepted -- the last confirmation is
-- what triggers the real acceptance, not any single person's own tap.
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
  select * into v_proposal from group_plan_proposals where id = proposal_id_param;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.status <> 'confirmed' or v_proposal.resulting_request_id is null then
    raise exception 'This group plan has not been finalized into a real request yet.';
  end if;

  select * into v_offer from business_request_offers where id = offer_id_param;
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

-- Rule 13 (partial): a stale, never-responded-to proposal expires on its
-- own real schedule instead of sitting pending forever -- folded into the
-- same cron sweep every other business-fulfillment expiry already uses,
-- not a new cron job.
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

  update group_plan_proposals
  set status = 'expired'
  where status = 'pending' and expires_at < now();
end;
$function$;
