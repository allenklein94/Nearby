-- Real user ask, not a code audit: "when I request a business partner from
-- your communities it gives me the option to select by business, but can't
-- I just send the request out by category? ... Italian restaurants nearby
-- get that signal and can give custom offers." This is exactly the
-- broadcast-with-competing-offers mechanism Business Fulfillment already
-- built for gatherings ("Ask Local Businesses" -> create_business_request_
-- for_gathering) and for matches (create_business_request_for_match) --
-- communities were the one real target type this app supports for
-- business partnership requests (request_business_partnership already
-- accepts target_type='community') that never got the broadcast half, only
-- the single-named-business half (RequestBusinessPartnerScreen).
--
-- CLAUDE.md's own Aug 14 2026 gathering-demand migration explicitly named
-- why communities were skipped at the time: "communities have no scheduled
-- date/precise location the way a gathering does... no real signal to
-- source party size/date/location from." The location half of that gap is
-- now closed -- communities gained a real, optional "Community Area"
-- (area_lat/area_lng, Aug 17 2026) specifically so a coarse community
-- location could back exactly this kind of feature. Party size/budget/date
-- stay genuinely caller-supplied here (unlike the gathering path, which
-- derives real party size from actual approved attendees) -- a community
-- has no fixed "this many people are coming" the way one specific
-- gathering does; the organizer is asking on behalf of a real but
-- self-described event (e.g. "our end-of-year mixer, about 100 people").

alter table public.business_requests
  add column if not exists community_id uuid references public.communities(id) on delete set null;

create index if not exists business_requests_community_id_idx on public.business_requests(community_id);

-- ---------- FUNCTION: create_business_request_for_community ----------
-- Creator/leader-only, matching request_business_partnership's own existing
-- ownership check for a community target verbatim (community_members.role
-- in ('creator','leader')) -- same "ask a business on behalf of the group"
-- authority model already established for gatherings (host-only) and this
-- exact single-business path.
--
-- Reuses every real piece of the already-proven Business Fulfillment
-- pipeline unchanged -- the same spam guard, the same fan-out, the same
-- availability/policy matching every other create_business_request*
-- variant already calls. This migration only adds a second, community-
-- scoped way to CREATE a request; the lifecycle underneath (offer, accept,
-- reservation, complete) is completely untouched.
create or replace function public.create_business_request_for_community(
  community_id_param uuid,
  raw_text_param text,
  category_param text default null::text,
  party_size_param integer default null::integer,
  budget_max_param integer default null::integer,
  date_param date default null::date,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owns_target boolean;
  v_lat double precision;
  v_lng double precision;
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

  select exists(
    select 1 from community_members
    where community_id = community_id_param and user_id = auth.uid() and role in ('creator', 'leader')
  ) into v_owns_target;

  if not v_owns_target then
    raise exception 'Only a community creator or leader can ask businesses on behalf of this community.';
  end if;

  select area_lat, area_lng into v_lat, v_lng from communities where id = community_id_param;

  if v_lat is null or v_lng is null then
    raise exception 'Set a Community Area for this community first, so nearby businesses can be found.';
  end if;

  -- Same real duplicate guard shape create_business_request_for_gathering
  -- already uses -- an already-open request for this exact community is
  -- returned as-is rather than spamming a second broadcast.
  select id into v_duplicate_id
  from business_requests
  where community_id = community_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_expires_at := case
    when date_param is not null then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_max, date,
    latitude, longitude, radius_miles, expires_at, community_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param, budget_max_param, date_param,
    v_lat, v_lng, coalesce(radius_miles_param, 15), v_expires_at, community_id_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, date_param, null, null) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), party_size_param, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request_for_community(uuid, text, text, integer, integer, date, double precision) from public, anon;
grant execute on function public.create_business_request_for_community(uuid, text, text, integer, integer, date, double precision) to authenticated;
