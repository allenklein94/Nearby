-- Phase 3 items 1-2 of the "Scorecard to 10" initiative (also Phase 4 item 2's own fix,
-- shared, not built twice — closes Group Plans' funnel gap for both categories at once).
-- See CLAUDE.md's Phase 3/4 plan text for the full reasoning.

-- Item 1: persist a submission_id onto business_requests at creation time so a
-- group-plan-originated request attributes back to its real originating individual ask.
-- Nullable, zero behavior change for every existing row -- only the solo intent-driven
-- create path (create_business_request) ever sets it; the gathering-sourced path has no
-- originating intent_submissions row to link, and stays null there, honestly.
alter table business_requests
  add column submission_id uuid references intent_submissions(id) on delete set null;

comment on column business_requests.submission_id is 'The real intent_submissions row that led to this request, when one exists (the solo Home intent flow). Null for gathering-sourced requests, which have no single originating submission.';

create or replace function create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time default null,
  time_window_end_param time default null,
  radius_miles_param double precision default 15,
  submission_id_param uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
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

  -- submission_id is only ever trusted when it genuinely belongs to the caller -- a
  -- stray/spoofed id from another user's submission is silently dropped rather than
  -- linked, same "never trust a client-supplied id blindly" convention this schema
  -- already uses elsewhere (e.g. propose_group_plan's own invitee re-validation).
  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, submission_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid())
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param) into v_avail_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$$;

-- Item 2: log the propose-time group-plan moment to intent_outcomes (today only
-- confirm-time is logged, per Wave 2B of the acceptance audit). A widened, additive
-- result_type value -- matching the same "add a new valid value, don't repurpose an
-- existing one" precedent business_requests.status's own 'merged' value already set.
alter table intent_outcomes drop constraint intent_outcomes_result_type_check;
alter table intent_outcomes add constraint intent_outcomes_result_type_check
  check (result_type = any (array['gathering', 'community', 'friend_request', 'perk', 'business_availability', 'business_offer', 'created_new', 'group_plan_proposed']));
