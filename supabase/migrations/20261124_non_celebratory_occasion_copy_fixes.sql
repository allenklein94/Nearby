-- Item 103 (CLAUDE.md, "Don't forget non-celebratory life events"). User's
-- own list: "Mom is visiting" / "My friend is moving away" / "We're back
-- in town" / "College reunion" / "Team celebration" / "First date" /
-- "New job" / "Retirement" -- "these are reasons to get people together...
-- this is why I like Occasions more than 'Celebrations.'"
--
-- An audit against this list found the underlying vocabulary and wizard
-- architecture already honestly covers almost every example: 'retirement'/
-- 'new_job'/'reunion'/'welcome'/'farewell'/'moving' were all already added
-- to every occasion-vocabulary CHECK constraint by Item 73's life-events
-- expansion (2026-09-12), and anything not on the named list ("Mom is
-- visiting") already has a first-class, dedicated path via Item 74's
-- Custom Occasion free-text flow -- there is no gap in WHAT can be
-- expressed. "First date" is deliberately left unbuilt as a named occasion
-- type here (see this session's own CLAUDE.md entry for the reasoning:
-- it would duplicate the already-real, dedicated match/date-planning flow
-- DateProposalScreen already owns, and remains fully expressible via
-- Custom Occasion for anyone who wants it as a personal record).
--
-- What the audit found instead were real, concrete instances of the exact
-- failure mode this item warns about: server-side copy that silently
-- assumes every occasion is a "celebration," producing wrong or awkward
-- text the moment a real non-celebratory occasion flows through it --
-- confirmed live against the currently-deployed function bodies before
-- writing any fix, not guessed from memory:
--
-- (1) _occasion_emoji()/_occasion_noun() -- the two shared helpers that
-- feed emoji/label text into 12 real push-sending functions (confirmed via
-- a live prosrc search: invite_to_business_request, submit_business_offer,
-- accept_business_offer/decline_business_offer, add_plan_organizer,
-- confirm_group_plan_offer, post_business_availability,
-- send_occasion_planning_nudges, send_occasion_group_plan_stall_nudges,
-- notify_occasion_demand_threshold, send_business_recall_outreach,
-- admin_review_business_content_screening) -- were missing 8 of Item 73's
-- own 8 new life-event values entirely (wedding/new_job/retirement/
-- achievement/moving/reunion/welcome/holiday_gathering all silently fell
-- through to a generic 📅/"Occasion"), so setting a real "Retirement" or
-- "New Job" occasion produced a bland, generic push everywhere a
-- "Birthday" or "Anniversary" occasion already got a rich, specific one --
-- exactly the asymmetry this item warns about. Also fixed a real, separate
-- mismatch caught in the same pass: the DB helper mapped 'milestone' to
-- 🏆, but the client's own OCCASION_OPTIONS (businessAttributes.js, the
-- authoritative vocabulary) maps 'milestone' to 🥂 and 'achievement' to
-- 🏆 -- the two had drifted. Both fixed to match the client exactly.
--
-- (2) create_plan_addon_request() -- its auto-generated, privacy-safe
-- business-facing raw_text (Item 80) hardcoded every add-on's own
-- description as "{Label} for a {occasion, underscores replaced}
-- celebration" regardless of actual occasion -- meaning a real florist or
-- photographer add-on tied to a farewell/moving/new-job occasion literally
-- read "Flowers for a farewell celebration" / "Photographer for a moving
-- celebration" / "Transportation for a new job celebration" in front of
-- the business deciding whether to respond. Fixed to use the same
-- corrected _occasion_noun() helper instead ("Flowers for a Farewell" /
-- "Transportation for a New Job"), with a minimal a/an article fix for the
-- three nouns that need it (Anniversary/Engagement/Achievement) -- a real,
-- small, pre-existing grammar bug in the original hardcoded text too
-- ("for a anniversary celebration"), fixed in the same pass since this
-- line was already being rewritten.

create or replace function public._occasion_emoji(occasion_type_param text)
returns text
language sql
immutable
as $function$
  select case occasion_type_param
    when 'birthday' then '🎂'
    when 'anniversary' then '💍'
    when 'celebration' then '🎉'
    when 'graduation' then '🎓'
    when 'baby_shower' then '🍼'
    when 'engagement' then '💒'
    when 'wedding' then '💐'
    when 'housewarming' then '🏠'
    when 'new_job' then '🚀'
    when 'promotion' then '📈'
    when 'retirement' then '🌅'
    when 'achievement' then '🏆'
    when 'moving' then '📦'
    when 'farewell' then '👋'
    when 'reunion' then '🤗'
    when 'welcome' then '🙌'
    when 'holiday_gathering' then '🎇'
    when 'milestone' then '🥂'
    when 'life_event' then '🌟'
    when 'other' then '✨'
    else '📅'
  end;
$function$;

create or replace function public._occasion_noun(occasion_type_param text)
returns text
language sql
immutable
as $function$
  select case occasion_type_param
    when 'birthday' then 'Birthday'
    when 'anniversary' then 'Anniversary'
    when 'celebration' then 'Celebration'
    when 'graduation' then 'Graduation'
    when 'baby_shower' then 'Baby Shower'
    when 'engagement' then 'Engagement'
    when 'wedding' then 'Wedding'
    when 'housewarming' then 'Housewarming'
    when 'new_job' then 'New Job'
    when 'promotion' then 'Promotion'
    when 'retirement' then 'Retirement'
    when 'achievement' then 'Achievement'
    when 'moving' then 'Moving'
    when 'farewell' then 'Farewell'
    when 'reunion' then 'Reunion'
    when 'welcome' then 'Welcome'
    when 'holiday_gathering' then 'Holiday Gathering'
    when 'milestone' then 'Milestone'
    when 'life_event' then 'Life Event'
    when 'other' then 'Occasion'
    else 'Occasion'
  end;
$function$;

create or replace function public.create_plan_addon_request(
  parent_request_id_param uuid,
  addon_type_param text,
  note_param text default null,
  plan_time_param time without time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parent record;
  v_category text;
  v_business_major text;
  v_label text;
  v_plan_label text;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_raw_text text;
  v_existing_open_id uuid;
  v_notified_count integer := 0;
  v_avail_new_count integer := 0;
  v_ai_new_count integer := 0;
begin
  if addon_type_param is null or addon_type_param not in ('dessert', 'flowers', 'photographer', 'decorations', 'transportation', 'gift', 'entertainment') then
    raise exception 'Invalid add-on type';
  end if;

  select * into v_parent from business_requests
    where id = parent_request_id_param
    for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if not public._can_manage_business_request(v_parent.id) then
    raise exception 'You are not authorized to add to this plan.';
  end if;
  if v_parent.parent_request_id is not null then
    raise exception 'Add-ons cannot themselves have add-ons.';
  end if;
  if v_parent.status = 'cancelled' then
    raise exception 'This plan was cancelled -- add-ons cannot be added to a cancelled request.';
  end if;

  v_plan_label := nullif(trim(coalesce(note_param, '')), '');

  select id into v_existing_open_id from business_requests
    where parent_request_id = parent_request_id_param
    and addon_type = addon_type_param
    and status = 'open'
    and plan_time is not distinct from plan_time_param
    and plan_label is not distinct from v_plan_label
    limit 1;
  if v_existing_open_id is not null then
    raise exception 'You already have an open % request for this plan at that time.', addon_type_param;
  end if;

  v_category := case addon_type_param
    when 'dessert' then 'Bakeries'
    when 'flowers' then 'Florist'
    when 'photographer' then 'Photography'
    when 'decorations' then 'Party & Event Decor'
    when 'gift' then 'Gift Shop'
    when 'entertainment' then 'Music'
    else null
  end;
  v_business_major := case addon_type_param
    when 'dessert' then 'food_drink'
    when 'flowers' then 'shopping'
    when 'photographer' then 'arts_culture_learning'
    when 'decorations' then 'shopping'
    when 'gift' then 'shopping'
    when 'entertainment' then 'entertainment_nightlife'
    when 'transportation' then 'auto_transportation'
  end;
  v_label := case addon_type_param
    when 'dessert' then 'Dessert'
    when 'flowers' then 'Flowers'
    when 'photographer' then 'Photographer'
    when 'decorations' then 'Decorations'
    when 'transportation' then 'Transportation'
    when 'gift' then 'Gift'
    when 'entertainment' then 'Entertainment'
  end;

  -- Item 103: a real occasion-aware label, not a hardcoded "celebration"
  -- -- see this migration's own header comment for the live-confirmed bug
  -- this replaces ("Flowers for a moving celebration").
  v_raw_text := v_label || case when v_parent.occasion is not null and v_parent.occasion <> 'other'
    then ' for ' || (case when v_parent.occasion in ('anniversary', 'engagement', 'achievement') then 'an ' else 'a ' end) || public._occasion_noun(v_parent.occasion)
    else ' to go with an upcoming plan' end
    || case when v_plan_label is not null then ' — ' || left(v_plan_label, 200) else '' end;

  v_expires_at := coalesce(v_parent.expires_at, now() + interval '48 hours');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start,
    time_window_end, latitude, longitude, radius_miles, expires_at, occasion,
    parent_request_id, addon_type, plan_time, plan_label
  ) values (
    auth.uid(), v_raw_text, v_category, v_parent.party_size, v_parent.date,
    v_parent.time_window_start, v_parent.time_window_end, v_parent.latitude,
    v_parent.longitude, v_parent.radius_miles, v_expires_at, v_parent.occasion,
    parent_request_id_param, addon_type_param, plan_time_param, v_plan_label
  ) returning id into v_request_id;

  select public._business_request_fanout(
    v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles,
    case when v_category is not null then array[v_category] else null end,
    case when v_category is null then v_business_major else null end
  ) into v_notified_count;

  if v_category is not null then
    select public._match_request_to_availability(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.date, v_parent.time_window_start, v_parent.time_window_end, null, v_parent.party_size) into v_avail_new_count;
    select public._ai_auto_respond_to_business_requests(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.party_size, v_parent.time_window_start, v_parent.time_window_end) into v_ai_new_count;
  end if;

  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'addonType', addon_type_param, 'category', v_category, 'notifiedCount', v_notified_count);
end;
$function$;
