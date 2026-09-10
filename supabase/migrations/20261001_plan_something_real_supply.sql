-- External UX critique reply, item 4 (CLAUDE.md, 2026-09-10): "Plan"
-- should mean planning something in the real world, not dumping the
-- proposer into a generic toolbox. The product thesis, restated by the
-- user verbatim: "connect people -> create something -> connect it to a
-- real business/place." DateProposalScreen.js's "Plan Something
-- Together" step already asked "What do you want to do?" with real quick-
-- category chips (Dinner/Coffee/Fitness/Something fun/Music/Outdoors/
-- Surprise me) -- what it never did is let the proposer actually look at
-- real nearby supply (businesses/places/offers) BEFORE sending the
-- invite. Today's order was propose (freeform text only) -> other person
-- accepts -> only THEN manually search businesses. The user's requested
-- order: pick a category -> see real live nearby options -> choose one
-- -> invite names that specific place -> once accepted, the plan is
-- already tied to it, no second manual search step needed.
--
-- This does NOT touch the locked "Match != Date" gate from "The Offer
-- System" Phase 5 (20260817_offer_system_phase5_date_proposals.sql,
-- Decision 4): a business is still never actually asked/reserved until
-- the OTHER person explicitly accepts the proposal -- browsing
-- search_active_business_availability() before that is read-only (no
-- business is contacted or reserved by looking), exactly like Home's own
-- intent box already does. What changes is that a specific real posting
-- can now be attached to a proposal (`availability_id`) so the moment it
-- IS accepted, the resulting business_requests row is bound to the exact
-- place the proposer already found and chose -- reusing the very same
-- "preferred_availability_id_param, re-validated live at claim time"
-- mechanism the solo ask flow (submitBusinessRequest) has used since
-- 20260822_availability_preferred_binding.sql, not a new concept.

-- ---------- date_proposals: two new nullable columns ----------
-- availability_id: the specific business_availability posting the
-- proposer found and chose via "Find something nearby," if any -- null
-- for a plain freeform-text or bare-category invite (today's exact
-- behavior, fully preserved). on delete set null (not cascade): if a
-- business later deletes/expires that posting, the proposal/plan itself
-- should still exist as a real historical record, just without a
-- still-live place attached.
-- category: the quick-category chip the proposer picked (if any),
-- persisted so the ACCEPTING device -- which never had the proposer's
-- own local session state -- can still prefill "Find Somewhere to Go"
-- correctly, and so create_business_request_for_match can record a real
-- category on the resulting request even when the recipient (not the
-- proposer) is the one whose acceptance triggers it.
alter table public.date_proposals
  add column if not exists availability_id uuid references public.business_availability(id) on delete set null,
  add column if not exists category text;

-- ---------- propose_date: two new trailing default params ----------
-- Added params only -- per this repo's own standing convention, this
-- creates a second overload unless the old exact signature is dropped
-- first.
drop function if exists public.propose_date(uuid, text);

create or replace function public.propose_date(
  match_id_param uuid,
  plan_text_param text,
  availability_id_param uuid default null,
  category_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match record;
  v_other_id uuid;
  v_proposal_id uuid;
  v_availability_still_live boolean;
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

  insert into date_proposals (match_id, proposed_by, plan_text, availability_id, category)
  values (match_id_param, auth.uid(), trim(plan_text_param), availability_id_param, category_param)
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

revoke all on function public.propose_date(uuid, text, uuid, text) from public, anon;
grant execute on function public.propose_date(uuid, text, uuid, text) to authenticated;

-- ---------- create_business_request_for_match: body-only change ----------
-- Signature is UNCHANGED (still the real 11-arg shape from
-- 20260912_business_request_occasion.sql) -- a plain CREATE OR REPLACE is
-- safe here, matching this repo's own "body-only, param list unchanged"
-- precedent (e.g. admin_review_business_content_screening). The only
-- change: the accepted proposal's own `availability_id`/`category` (read
-- into v_proposal below, already selected via `select * into v_proposal`)
-- are threaded into _match_request_to_availability()'s existing
-- preferred_availability_id_param slot and into the stored request's
-- category, so a proposal that already named a specific real place binds
-- to it immediately -- the exact same "preferred posting, re-verified
-- live at claim time" mechanism the solo ask flow already uses, not a
-- new one. category_param (the caller's own explicit argument) still
-- wins when both are present, matching every other prefill-vs-explicit
-- precedent in this codebase ("AI suggests, never silently commits" --
-- here, the proposal's own stored category is a real prior answer, not a
-- guess, so it's a genuine fallback, not an override).
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
  radius_miles_param double precision default 15,
  occasion_param text default null
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
  v_category text;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if occasion_param is not null and occasion_param not in ('birthday', 'anniversary', 'date_night', 'celebration', 'casual_hangout', 'business_meal', 'family_gathering', 'other') then
    raise exception 'Invalid occasion';
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

  v_category := coalesce(category_param, v_proposal.category);

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
    expires_at, match_id, occasion
  ) values (
    auth.uid(), trim(raw_text_param), v_category, 2, budget_max_param, date_param,
    time_window_start_param, time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at, match_id_param, occasion_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), v_category, date_param, time_window_start_param, time_window_end_param, v_proposal.availability_id, 2) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), 2, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', 2);
end;
$function$;

revoke all on function public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision, text) from public, anon;
grant execute on function public.create_business_request_for_match(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision, text) to authenticated;
