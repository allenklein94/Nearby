-- "The Offer System" Phase 5 (see CLAUDE.md's own plan, Decision 4): the
-- dating-match bridge into the Request/Offer system -- locked shape,
-- restated verbatim: Match -> Proposal -> Other person accepts -> Dating
-- Experience created -> Business Request. Match != Date, mirroring
-- "Accepted != Confirmed" from Decision 2 exactly (the user named that
-- parallel directly): a mutual match alone never authorizes fanning a
-- request out to businesses; one person proposes a real plan, the other
-- explicitly accepts it.
--
-- Checked live first, per this plan's own instruction, before inventing
-- anything: no existing table covers "one match member proposes a
-- specific plan to the other" -- date_checkins is the unrelated safety
-- check-in feature, group_plan_proposals is Phase D's own multi-person
-- mechanism. Built minimally, exactly per the plan's own locked column
-- list: match_id, proposed_by, plan_text, status (proposed | accepted |
-- declined | withdrawn), created_at, responded_at -- no expires_at, no
-- auto-expiry cascade added to expire_stale_business_requests() this
-- pass, a deliberate scope boundary matching the plan's own minimal
-- design: the recipient can always explicitly decline a stale proposal,
-- and the proposer can always withdraw one, so nothing here can hang
-- silently forever without a real action available to resolve it.
--
-- "Dating Experience created" is deliberately NOT a new stored object,
-- matching this schema's own "don't over-normalize into a table per
-- diagram node" convention (Decision 2's own "Experience Confirmed" is
-- the same call) -- the accepted date_proposals row itself IS the real,
-- queryable record of the Dating Experience; nothing further to store.

create table if not exists public.date_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  plan_text text not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- Only one real, undecided proposal in flight per match at a time --
-- matches this schema's own established partial-unique-index convention
-- for exactly this shape of guard (e.g. business_partner_requests' own
-- one-pending-per-requester index).
create unique index if not exists date_proposals_one_active_per_match_idx
on public.date_proposals (match_id)
where status = 'proposed';

alter table public.date_proposals enable row level security;

-- No INSERT/UPDATE policy -- every write goes through propose_date()/
-- respond_to_date_proposal()/withdraw_date_proposal() below, matching
-- this schema's own established "no direct client write on a lifecycle
-- table" convention (business_request_offers, group_plan_proposals,
-- social_offers, etc.).
create policy "Match participants can view date proposals"
on public.date_proposals for select
using (
  exists (
    select 1 from public.matches m
    where m.id = date_proposals.match_id
    and (m.user_a = auth.uid() or m.user_b = auth.uid())
  )
);

-- The real Request-object bridge: a match-sourced business_requests row,
-- mirroring gathering_id's own nullable-FK shape exactly. No schema
-- change needed on business_request_offers itself -- it's already
-- request_id-scoped and doesn't care where the parent request came from.
alter table public.business_requests add column if not exists match_id uuid references public.matches(id) on delete set null;

-- ---------- FUNCTION: is_match_participant ----------
-- Same established shape as is_group_plan_participant/is_blocked --
-- SECURITY DEFINER, and internally guards auth.uid() = user_id_param so
-- it can only ever answer for the caller's own involvement, never used
-- to probe an arbitrary pair. Needed because matches' own SELECT RLS
-- also filters on is_blocked(user_a, user_b) -- a plain EXISTS subquery
-- from inside another table's policy would silently re-trigger that same
-- RLS on the nested matches read, which is correct in the common case
-- but not the explicit, defensible shape this codebase's own history has
-- settled on for cross-table visibility checks.
create or replace function public.is_match_participant(match_id_param uuid, user_id_param uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when auth.uid() <> user_id_param then false
    else exists (
      select 1 from matches
      where id = match_id_param and (user_a = user_id_param or user_b = user_id_param)
    )
  end;
$function$;

revoke all on function public.is_match_participant(uuid, uuid) from public, anon;
grant execute on function public.is_match_participant(uuid, uuid) to authenticated;

-- Additive SELECT policies, same shape as Phase D's own group-plan
-- policies on these exact two tables -- a match-sourced request (and its
-- offers) becomes visible to BOTH participants, not just whichever one
-- happened to submit it.
create policy "Match participants can view the resulting request"
on public.business_requests for select
using (match_id is not null and public.is_match_participant(match_id, auth.uid()));

create policy "Match participants can view offers on their request"
on public.business_request_offers for select
using (
  exists (
    select 1 from public.business_requests br
    where br.id = business_request_offers.request_id
    and br.match_id is not null
    and public.is_match_participant(br.match_id, auth.uid())
  )
);

-- ---------- FUNCTION: propose_date ----------
create or replace function public.propose_date(match_id_param uuid, plan_text_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match record;
  v_other_id uuid;
  v_proposal_id uuid;
  service_key text;
  v_proposer_name text;
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

  insert into date_proposals (match_id, proposed_by, plan_text)
  values (match_id_param, auth.uid(), trim(plan_text_param))
  returning id into v_proposal_id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_proposer_name from profiles where id = auth.uid();
  if service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_other_id,
        'title', 'A plan for you two 💌',
        'body', coalesce(v_proposer_name, 'Your match') || ' proposed a plan: "' || left(trim(plan_text_param), 60) || '"',
        'data', jsonb_build_object('type', 'date_proposal', 'proposal_id', v_proposal_id, 'match_id', match_id_param)
      )
    );
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'status', 'proposed');
end;
$function$;

revoke all on function public.propose_date(uuid, text) from public, anon;
grant execute on function public.propose_date(uuid, text) to authenticated;

-- ---------- FUNCTION: respond_to_date_proposal ----------
-- The real "Match != Date" gate: only the person who did NOT propose can
-- accept/decline -- rejects the proposer trying to respond to their own
-- proposal, same as a real same-side double-accept would be.
create or replace function public.respond_to_date_proposal(proposal_id_param uuid, accept_param boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
  v_match record;
  service_key text;
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

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_responder_name from profiles where id = auth.uid();
  if service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_proposal.proposed_by,
        'title', case when accept_param then 'Your match said yes! 🎉' else 'An update on your plan' end,
        'body', coalesce(v_responder_name, 'Your match') || case when accept_param then ' accepted your plan.' else ' can''t make that plan work this time.' end,
        'data', jsonb_build_object('type', 'date_proposal_response', 'proposal_id', proposal_id_param, 'match_id', v_proposal.match_id, 'accepted', accept_param)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

revoke all on function public.respond_to_date_proposal(uuid, boolean) from public, anon;
grant execute on function public.respond_to_date_proposal(uuid, boolean) to authenticated;

-- ---------- FUNCTION: withdraw_date_proposal ----------
-- Proposer-only, only while still genuinely undecided -- mirrors
-- withdraw_business_offer()'s own established shape (Phase 1).
create or replace function public.withdraw_date_proposal(proposal_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proposal record;
begin
  select * into v_proposal from date_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Plan not found.';
  end if;
  if v_proposal.proposed_by <> auth.uid() then
    raise exception 'Only the person who proposed this plan can withdraw it.';
  end if;
  if v_proposal.status <> 'proposed' then
    raise exception 'This plan can no longer be withdrawn.';
  end if;

  update date_proposals set status = 'withdrawn', responded_at = now() where id = proposal_id_param;
end;
$function$;

revoke all on function public.withdraw_date_proposal(uuid) from public, anon;
grant execute on function public.withdraw_date_proposal(uuid) to authenticated;

-- ---------- FUNCTION: create_business_request_for_match ----------
-- The actual authorization gate this whole phase exists for: this can
-- ONLY fan out once a real accepted date_proposals row exists for this
-- match -- a bare match, or a still-pending/declined/withdrawn proposal,
-- is never enough. party_size is hardcoded to 2 (real, both match
-- participants -- never user-typed, matching create_business_request_
-- for_gathering()'s own "server-computed, not user-supplied" precedent).
-- latitude/longitude are caller-supplied (like the solo path) since,
-- unlike a gathering, a match has no stored location of its own to read
-- server-side -- there is no honest server-side location source for two
-- people's own date plan.
create or replace function public.create_business_request_for_match(
  match_id_param uuid,
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time without time zone default null,
  time_window_end_param time without time zone default null,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match record;
  v_proposal record;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  select * into v_match from matches where id = match_id_param;
  if v_match is null then
    raise exception 'Match not found.';
  end if;
  if auth.uid() <> v_match.user_a and auth.uid() <> v_match.user_b then
    raise exception 'You are not part of this match.';
  end if;

  select * into v_proposal
  from date_proposals
  where match_id = match_id_param and status = 'accepted'
  order by responded_at desc
  limit 1;

  if v_proposal is null then
    raise exception 'A plan must be proposed and accepted by your match before asking businesses.';
  end if;

  select id into v_duplicate_id
  from business_requests
  where match_id = match_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', 2);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', 2);
  end if;

  v_expires_at := case
    when date_param is not null and time_window_end_param is not null
      then (date_param + time_window_end_param)::timestamptz
    when date_param is not null
      then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_max, date,
    time_window_start, time_window_end, latitude, longitude, radius_miles,
    expires_at, match_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, 2, budget_max_param, date_param,
    time_window_start_param, time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at, match_id_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), 2, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', 2);
end;
$function$;

revoke all on function public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision) from public, anon;
grant execute on function public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision) to authenticated;
