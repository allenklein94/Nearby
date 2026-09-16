-- Item 95 (CLAUDE.md, direct user request): "Ask 'How important is the
-- occasion?' This could become a surprisingly useful recommendation
-- signal. What kind of experience are you looking for? Keep it simple /
-- Make it special / Go all out. That allows the engine to adjust
-- recommendations. A birthday dinner doesn't need the same recommendations
-- as a 50th anniversary."
--
-- Resumed after a codespace restart -- the client-side groundwork
-- (EXPERIENCE_LEVEL_OPTIONS/experienceLevelLabel/experienceLevelToPriceLevel
-- in celebrateSomething.js, and resolveDecidedGroupPlanParams carrying
-- initialExperienceLevel forward) was already written and committed to the
-- working tree before the restart; this migration is the DB half that was
-- never started, plus the client wiring that actually uses it.
--
-- A real, explicit, always-editable answer -- never AI-inferred, same
-- posture as Item 94's own budget question right next to it. Distinct from
-- budget: this is about effort/curation, not a dollar figure (a "keep it
-- simple" ask can still have a real budget, and vice versa). Ties to two
-- real, concrete levers rather than sitting inert:
-- (1) resolveIntent()'s own already-existing, already-tested priceLevel
--     scoring param (experienceLevelToPriceLevel()) -- 'go_all_out' nudges
--     toward pricier/more-curated real candidates, 'special' toward
--     mid-tier, 'simple' stays unbiased (this is a signal about care/
--     curation, not necessarily cheapness).
-- (2) a real, honest context signal surfaced to the business deciding how
--     to respond -- mirrors Item 70's date chip / Item 81's plan_time chip
--     already added to the same "What they're looking for" tag row, since
--     a business crafting a Special-Occasion offer (Item 92) genuinely
--     benefits from knowing whether this is a low-key ask or a go-all-out
--     one.
--
-- Scope, disclosed: wired into business_requests (the solo
-- create_business_request path, reachable from AskBusinessScreen's own
-- solo mode and CelebrateSomethingScreen's business-options submit) and
-- occasion_group_plans (the group-vote path, both its own resolveIntent()
-- call for proposing business options and the resulting decided payload).
-- NOT wired into create_business_request_for_gathering/_for_match/
-- _for_community -- same disclosed "first increment" scope boundary Item
-- 68's package-matching and Item 81's plan_time additions already drew.

alter table public.business_requests
  add column if not exists experience_level text;
alter table public.business_requests drop constraint if exists business_requests_experience_level_check;
alter table public.business_requests
  add constraint business_requests_experience_level_check
  check (experience_level is null or experience_level in ('simple', 'special', 'go_all_out'));

alter table public.occasion_group_plans
  add column if not exists experience_level text;
alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_experience_level_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_experience_level_check
  check (experience_level is null or experience_level in ('simple', 'special', 'go_all_out'));

-- ---- create_business_request: new trailing experience_level_param ----
-- Per this repo's own standing convention, a changed parameter list
-- creates a second overload rather than replacing the original -- explicit
-- drop of the old live 17-arg signature first (confirmed live via
-- pg_get_function_identity_arguments before writing this).

drop function if exists public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid);

create or replace function public.create_business_request(
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
  submission_id_param uuid default null,
  preferred_availability_id_param uuid default null,
  attributes_param text[] default null,
  cuisine_param text default null,
  occasion_param text default null,
  preferred_package_id_param uuid default null,
  experience_level_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_ai_new_count integer;
  v_package_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if attributes_param is not null and not (attributes_param <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused'
  ]::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  if experience_level_param is not null and experience_level_param not in ('simple', 'special', 'go_all_out') then
    raise exception 'Invalid experience level';
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

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, submission_id, attributes, cuisine, occasion,
    experience_level
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param,
    experience_level_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param, party_size_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  select public._match_request_to_package(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), occasion_param, party_size_param, date_param, preferred_package_id_param) into v_package_new_count;
  select public._ai_auto_respond_to_business_requests(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, party_size_param, time_window_start_param, time_window_end_param) into v_ai_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0) + coalesce(v_package_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text) to authenticated;

-- ---- create_occasion_group_plan: new trailing experience_level_param ----
-- Explicit drop of the old live 10-arg signature (Item 66's own budget
-- addition) first.

drop function if exists public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean, integer, integer);

create or replace function public.create_occasion_group_plan(
  occasion_type_param text,
  title_param text,
  who_for_name_param text,
  who_for_friend_id_param uuid,
  when_preset_param text,
  scheduled_date_param date,
  invitee_ids_param uuid[],
  surprise_mode_param boolean default false,
  budget_min_param integer default null,
  budget_max_param integer default null,
  experience_level_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan_id uuid;
  v_invitee_id uuid;
  v_invited_count integer := 0;
  service_key text;
  v_host_name text;
  v_wants_notif boolean;
begin
  if title_param is null or trim(title_param) = '' then
    raise exception 'This occasion needs a title.';
  end if;
  if budget_min_param is not null and budget_max_param is not null and budget_min_param > budget_max_param then
    raise exception 'Budget minimum can''t be more than the maximum.';
  end if;
  if experience_level_param is not null and experience_level_param not in ('simple', 'special', 'go_all_out') then
    raise exception 'Invalid experience level';
  end if;

  insert into occasion_group_plans (
    host_id, occasion_type, title, who_for_name, who_for_friend_id, when_preset, scheduled_date,
    surprise_mode, budget_min, budget_max, experience_level
  ) values (
    auth.uid(), occasion_type_param, trim(title_param), who_for_name_param, who_for_friend_id_param,
    when_preset_param, scheduled_date_param, coalesce(surprise_mode_param, false), budget_min_param, budget_max_param,
    experience_level_param
  ) returning id into v_plan_id;

  insert into occasion_group_plan_participants (group_plan_id, user_id, status, responded_at)
  values (v_plan_id, auth.uid(), 'joined', now());

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = auth.uid();
      continue when is_blocked(auth.uid(), v_invitee_id);
      -- Item 65: never invite the person this occasion is for when
      -- surprise mode is on -- a clean early-skip so the rest of the
      -- invite list (and the plan itself) still succeeds. The trigger
      -- above is a structural backstop, not the primary mechanism.
      continue when coalesce(surprise_mode_param, false) and who_for_friend_id_param is not null and v_invitee_id = who_for_friend_id_param;

      -- Real connections only -- accepted friend or active match. Same
      -- eligibility check invite_to_business_request already established;
      -- standing "no stranger discovery via intent" rule.
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

      begin
        insert into occasion_group_plan_participants (group_plan_id, user_id, status)
        values (v_plan_id, v_invitee_id, 'invited');
        v_invited_count := v_invited_count + 1;
      exception when unique_violation then
        continue;
      end;

      select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
      if service_key is not null and v_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_invitee_id,
            'title', '🗳️ You''re invited to plan together',
            'body', coalesce(v_host_name, 'Someone you know') || ' wants your vote on ' || trim(title_param) || '.',
            'data', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', v_plan_id)
          )
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object('planId', v_plan_id, 'invitedCount', v_invited_count);
end;
$function$;

revoke all on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean, integer, integer, text) from public, anon;
grant execute on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean, integer, integer, text) to authenticated;

-- ---- get_occasion_group_plan_detail: also return experienceLevel ----
-- RETURNS jsonb, unchanged signature -- plain CREATE OR REPLACE is safe.

create or replace function public.get_occasion_group_plan_detail(plan_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_result jsonb;
begin
  if not is_occasion_group_plan_participant(plan_id_param, auth.uid()) then
    raise exception 'You are not part of this plan.';
  end if;

  select * into v_plan from occasion_group_plans where id = plan_id_param;

  select jsonb_build_object(
    'id', v_plan.id,
    'hostId', v_plan.host_id,
    'isHost', v_plan.host_id = auth.uid(),
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'status', v_plan.status,
    'winningOptionId', v_plan.winning_option_id,
    'decidedAt', v_plan.decided_at,
    'expiresAt', v_plan.expires_at,
    'createdAt', v_plan.created_at,
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max,
    'experienceLevel', v_plan.experience_level,
    'myStatus', (
      select status from occasion_group_plan_participants
      where group_plan_id = plan_id_param and user_id = auth.uid()
    ),
    'myIsOrganizer', (
      v_plan.host_id = auth.uid() or exists (
        select 1 from occasion_group_plan_participants
        where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined' and is_organizer
      )
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', pp.user_id, 'displayName', pr.display_name, 'status', pp.status, 'isOrganizer', pp.is_organizer
      ) order by pp.invited_at)
      from occasion_group_plan_participants pp
      join profiles pr on pr.id = pp.user_id
      where pp.group_plan_id = plan_id_param
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'optionKind', o.option_kind,
        'activityType', o.activity_type,
        'label', o.label,
        'proposedBy', o.proposed_by,
        'businessAvailabilityId', o.business_availability_id,
        'partnerName', bp.name,
        'postingTitle', ba.title,
        'price', ba.price,
        'startsAt', ba.starts_at,
        'stillActive', case when o.option_kind = 'business' then coalesce(
          ba.status = 'active' and ba.ends_at > now() and (ba.remaining_capacity is null or ba.remaining_capacity > 0) and bp.active,
          false
        ) else null end,
        'voteCount', (select count(*) from occasion_group_plan_votes v where v.option_id = o.id),
        'myVote', exists (select 1 from occasion_group_plan_votes v where v.option_id = o.id and v.voter_id = auth.uid())
      ) order by o.created_at)
      from occasion_group_plan_options o
      left join business_availability ba on ba.id = o.business_availability_id
      left join brand_partners bp on bp.id = ba.partner_id
      where o.group_plan_id = plan_id_param
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_occasion_group_plan_detail(uuid) from public, anon;
grant execute on function public.get_occasion_group_plan_detail(uuid) to authenticated;

-- ---- decide_occasion_group_plan: also return experienceLevel ----
-- Lets resolveDecidedGroupPlanParams() (already shipped client-side) carry
-- the group's own real answer forward into the wizard's post-decide "find
-- options nearby" step and the resulting business_requests row, same
-- shape budgetMin/budgetMax already established. Unchanged signature --
-- plain CREATE OR REPLACE is safe.

create or replace function public.decide_occasion_group_plan(plan_id_param uuid, option_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_option record;
  v_party_size integer;
  service_key text;
  v_participant record;
  v_wants_notif boolean;
  v_is_business boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'This plan has already been decided or cancelled.';
  end if;

  select * into v_option from occasion_group_plan_options where id = option_id_param and group_plan_id = plan_id_param;
  if v_option is null then
    raise exception 'That option does not belong to this plan.';
  end if;

  select count(*) into v_party_size from occasion_group_plan_participants
  where group_plan_id = plan_id_param and status = 'joined';

  v_is_business := v_option.activity_type in ('dinner', 'night_out', 'activity');

  if v_is_business then
    update occasion_group_plans
    set status = 'voting_business', winning_option_id = option_id_param
    where id = plan_id_param;
  else
    update occasion_group_plans
    set status = 'decided', winning_option_id = option_id_param, decided_at = now()
    where id = plan_id_param;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_participant.user_id,
          'title', case when v_is_business then '🍽️ Vote on where!' else '🎉 It''s decided!' end,
          'body', case when v_is_business
            then v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won -- Nearby is finding real options for the group to vote on.'
            else v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won the vote.'
          end,
          'data', jsonb_build_object(
            'type', case when v_is_business then 'occasion_group_plan_voting_business' else 'occasion_group_plan_decided' end,
            'plan_id', plan_id_param
          )
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when v_is_business then 'voting_business' else 'decided' end,
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'activityType', v_option.activity_type,
    'label', v_option.label,
    'partySize', greatest(v_party_size, 1),
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max,
    'experienceLevel', v_plan.experience_level
  );
end;
$function$;

revoke all on function public.decide_occasion_group_plan(uuid, uuid) from public, anon;
grant execute on function public.decide_occasion_group_plan(uuid, uuid) to authenticated;

-- ---- get_business_opportunities: also return experience_level ----
-- Real context for the business deciding how to respond (Item 92's
-- structured-offer path in particular) -- mirrors addon_type/plan_time's
-- own additions to this same jsonb. RETURNS jsonb, unchanged signature --
-- plain CREATE OR REPLACE is safe.

create or replace function public.get_business_opportunities(partner_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price, bro.price_is_per_person,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id,
      jsonb_build_object(
        'raw_text', br.raw_text,
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'gathering_id', br.gathering_id,
        'match_id', br.match_id,
        'attributes', br.attributes,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'plan_label', br.plan_label,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level,
          'party_type', g.party_type
        ) else null end,
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$function$;

revoke all on function public.get_business_opportunities(uuid) from public, anon;
grant execute on function public.get_business_opportunities(uuid) to authenticated;
