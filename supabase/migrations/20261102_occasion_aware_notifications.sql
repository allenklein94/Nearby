-- Item 78 (CLAUDE.md, "the notification system becomes dramatically more
-- useful"). User's own examples of what a push should read like once it has
-- real context: "🎂 Sarah's birthday is next week." / "💍 Your anniversary is
-- coming up." / "🎓 John's graduation is Saturday." / "🎉 Your group hasn't
-- finalized the birthday plan yet." / "🍽️ A business responded to your
-- birthday request." / "✅ Your reservation for Sarah's birthday is
-- confirmed."
--
-- The first three examples were already fully live before this migration --
-- send_occasion_planning_nudges()/send_birthday_planning_nudges()
-- (20261017/20261022) already send exactly this shape for every occasion
-- type the schema allows. This migration closes the two real remaining
-- gaps, both leaning on the Occasion <-> Plan linkage
-- ("Occasion architecture should not be a silo", 20261021_occasion_plan_
-- linkage.sql) that already exists but had never been read from anywhere
-- except the occasion-upcoming nudge itself:
--
--   1. "Your group hasn't finalized the plan yet" -- occasion_group_plans
--      had no stall detection at all. New send_occasion_group_plan_stall_
--      nudges(), same cron-nudge shape as every sibling in this file's own
--      family, fires once per plan (a new stall_nudge_sent_at dedup column,
--      since this is the first occasion_group_plans nudge that isn't keyed
--      to a specific calendar date) to the HOST ONLY -- the single final
--      decider per Item 66's own "no complex RSVP, one decider" guardrail,
--      not every organizer -- once a plan has sat in 'voting'/
--      'voting_business' for 3+ days, or its own scheduled_date is within
--      3 days and it's still undecided.
--
--   2. Two consumer-facing pushes that already exist but read as pure
--      boilerplate ("A business responded to \"...\"", or nothing at all)
--      even when a real, already-linked Occasion sits right behind the
--      underlying business_requests row. Every site that sends
--      'business_offer_received' (admin_review_business_content_screening's
--      offer_response branch, post_business_availability's immediate-match
--      branch, submit_business_offer) now looks up that linked occasion (if
--      any) via a new _occasion_context_for_business_request() helper and,
--      when one exists, leads with its emoji/occasion noun/who-for-name
--      instead of an anonymous text snippet -- falling back to the exact
--      previous generic copy when no occasion is linked, so the common
--      non-occasion case is byte-for-byte unchanged. A genuine, previously
--      entirely-missing "reservation confirmed" push is added to the
--      consumer's own side of accept_business_offer (today it only ever
--      notifies the BUSINESS that its offer was accepted -- the person who
--      just booked never gets their own confirmation), and
--      confirm_group_plan_offer's own equivalent final push is widened to
--      include the confirming participant themselves (a real, separate bug
--      found while building this: that loop already excludes `user_id <>
--      auth.uid()`, which is correct for the earlier "someone else
--      confirmed, you should too" nudge but wrong here -- it meant the
--      person whose own tap just finalized the reservation was the ONE
--      participant who never got told it was confirmed).
--
-- Per Item 69's own locked privacy boundary ("businesses shouldn't need to
-- know the person's identity" -- composeCelebrationAskTextForBusiness()
-- strips who_for_name out of raw_text specifically so a business never
-- learns it), who_for_name is used ONLY in the two consumer-facing push
-- sites this migration touches -- never surfaced in any push or column read
-- by a business. The business-facing "Your offer was accepted!"/"Your
-- availability was just matched!" pushes are deliberately left untouched.
--
-- Every function re-created below keeps its exact existing signature (no
-- new overload risk) -- confirmed via pg_get_function_identity_arguments
-- live before/after applying.

-- ---------- Shared, single-sourced occasion vocabulary ----------
-- Extracted from send_occasion_planning_nudges()'s own inline CASE
-- expressions (20261022) so every notification-composing function in this
-- schema shares one emoji/noun mapping instead of copies that can drift --
-- the exact "one ontology" lesson Item 27's audit already named. Anniversary
-- emoji corrected from send_occasion_planning_nudges()'s original 💑 to 💍,
-- matching the user's own example verbatim in this item's request.

create or replace function public._occasion_emoji(occasion_type_param text)
returns text
language sql
immutable
as $$
  select case occasion_type_param
    when 'birthday' then '🎂'
    when 'anniversary' then '💍'
    when 'graduation' then '🎓'
    when 'baby_shower' then '🍼'
    when 'engagement' then '💒'
    when 'housewarming' then '🏠'
    when 'promotion' then '📈'
    when 'farewell' then '👋'
    when 'milestone' then '🏆'
    when 'life_event' then '🌟'
    else '📅'
  end;
$$;

revoke all on function public._occasion_emoji(text) from public, anon;

create or replace function public._occasion_noun(occasion_type_param text)
returns text
language sql
immutable
as $$
  select case occasion_type_param
    when 'birthday' then 'Birthday'
    when 'anniversary' then 'Anniversary'
    when 'graduation' then 'Graduation'
    when 'baby_shower' then 'Baby Shower'
    when 'engagement' then 'Engagement'
    when 'housewarming' then 'Housewarming'
    when 'promotion' then 'Promotion'
    when 'farewell' then 'Farewell'
    when 'milestone' then 'Milestone'
    when 'life_event' then 'Life Event'
    else 'Occasion'
  end;
$$;

revoke all on function public._occasion_noun(text) from public, anon;

create or replace function public.send_occasion_planning_nudges()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  service_key text;
  occasion_row record;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
  v_lead_days int;
  v_body_suffix text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for occasion_row in
    select id, user_id, occasion_type, title, occasion_date, recurs_annually,
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at
    from occasions
  loop
    if occasion_row.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from occasion_row.occasion_date)::int;
      v_day := extract(day from occasion_row.occasion_date)::int;
      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;
      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;
    else
      v_next_date := occasion_row.occasion_date;
    end if;

    v_lead_days := case occasion_row.occasion_type
      when 'anniversary' then 14
      when 'graduation' then 14
      when 'baby_shower' then 14
      when 'engagement' then 14
      when 'housewarming' then 14
      else 7
    end;

    if (v_next_date - current_date) <> v_lead_days then
      continue;
    end if;

    -- Already turned into a real plan for this upcoming date -- don't nag
    -- about something the user already handled. See this migration's own
    -- header comment for why ~350 days is an honest approximation, not an
    -- exact per-year-instance check this table has no way to make.
    if occasion_row.resulting_plan_id is not null
       and occasion_row.last_planned_at is not null
       and occasion_row.last_planned_at > (v_next_date - interval '350 days') then
      continue;
    end if;

    if not coalesce((select notify_social from profiles where id = occasion_row.user_id), true) then
      continue;
    end if;

    v_body_suffix := case occasion_row.occasion_type when 'anniversary' then 'together?' else '?' end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', occasion_row.user_id,
        'title', _occasion_emoji(occasion_row.occasion_type) || ' Upcoming ' || _occasion_noun(occasion_row.occasion_type),
        'body', occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something' || v_body_suffix,
        'data', jsonb_build_object(
          'type', 'occasion_upcoming',
          'occasion_id', occasion_row.id,
          'occasion_type', occasion_row.occasion_type,
          'occasion_title', occasion_row.title,
          'who_for_name', occasion_row.who_for_name,
          'who_for_friend_id', occasion_row.who_for_friend_id
        )
      )
    );
  end loop;
end;
$function$;

revoke all on function public.send_occasion_planning_nudges() from public, anon;

-- ---------- Occasion <-> business_requests context lookup ----------
-- plans.resulting_business_request_id -> occasions.resulting_plan_id /
-- occasion_group_plans.resulting_plan_id is the exact linkage
-- "Occasion architecture should not be a silo" (20261021) already built for
-- OccasionsScreen's "✅ Planned" badge -- this is its first read from the
-- notification layer. SECURITY DEFINER + revoked from public/anon, same
-- internal-helper posture as is_occasion_group_plan_participant(): callable
-- from other SECURITY DEFINER functions (which run as this function's
-- owner) but not directly by any client role.

create or replace function public._occasion_context_for_business_request(request_id_param uuid)
returns table(occasion_type text, who_for_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(o.occasion_type, ogp.occasion_type), coalesce(o.who_for_name, ogp.who_for_name)
  from public.plans pl
  left join public.occasions o on o.resulting_plan_id = pl.id
  left join public.occasion_group_plans ogp on ogp.resulting_plan_id = pl.id
  where pl.resulting_business_request_id = request_id_param
  and (o.id is not null or ogp.id is not null)
  limit 1;
$$;

revoke all on function public._occasion_context_for_business_request(uuid) from public, anon;

-- ---------- Gap 1: "Your group hasn't finalized the plan yet" ----------

alter table public.occasion_group_plans
  add column if not exists stall_nudge_sent_at timestamptz;

create or replace function public.send_occasion_group_plan_stall_nudges()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  service_key text;
  plan_row record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for plan_row in
    select id, host_id, occasion_type
    from occasion_group_plans
    where status in ('voting', 'voting_business')
    and stall_nudge_sent_at is null
    and (
      created_at <= now() - interval '3 days'
      or (scheduled_date is not null and scheduled_date >= current_date and scheduled_date - current_date <= 3)
    )
  loop
    update occasion_group_plans set stall_nudge_sent_at = now() where id = plan_row.id;

    if service_key is not null and coalesce((select notify_planning from profiles where id = plan_row.host_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', plan_row.host_id,
          'title', '🎉 Still deciding?',
          'body', 'Your group hasn''t finalized the ' || lower(_occasion_noun(plan_row.occasion_type)) || ' plan yet.',
          'data', jsonb_build_object('type', 'occasion_group_plan_stalled', 'plan_id', plan_row.id)
        )
      );
    end if;
  end loop;
end;
$function$;

revoke all on function public.send_occasion_group_plan_stall_nudges() from public, anon;

select cron.schedule('send-occasion-group-plan-stall-nudges', '0 12 * * *', 'select send_occasion_group_plan_stall_nudges();');

-- ---------- Gap 2: occasion-aware "a business responded" / "reservation confirmed" ----------

create or replace function public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  service_key text;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := now();
    v_ends_at := case
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      )
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    if coalesce((select notify_business from profiles where id = v_requester_id), true) then
      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      select name into v_partner_name from brand_partners where id = v_row.partner_id;
      select occasion_type, who_for_name into v_occ_type, v_occ_who
      from _occasion_context_for_business_request(nullif(v_row.content_snapshot->>'requestId', '')::uuid);

      if v_occ_type is not null then
        v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
        v_push_body := coalesce(v_partner_name, 'A business') || ' responded to your ' || lower(_occasion_noun(v_occ_type)) || ' request'
          || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
      else
        v_push_title := 'New offer for your request!';
        v_push_body := coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"';
      end if;

      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_requester_id,
          'title', v_push_title,
          'body', v_push_body,
          'data', jsonb_build_object('type', 'business_offer_received', 'request_id', nullif(v_row.content_snapshot->>'requestId', '')::uuid)
        )
      );
    end if;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$
;

create or replace function public.post_business_availability(category_param text, title_param text, description_param text, offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone, ends_at_param timestamp with time zone, radius_miles_param double precision default 15, bundle_occasion_param text default null::text, bundle_components_param text[] default null::text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_req record;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  service_key text;
  v_bundle_components text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;
  if title_param is null or length(trim(title_param)) = 0 then
    raise exception 'Give this availability a real title.';
  end if;
  if ends_at_param <= starts_at_param then
    raise exception 'End time must be after the start time.';
  end if;

  if bundle_occasion_param is not null and bundle_occasion_param not in (
    'date_night', 'anniversary', 'birthday', 'celebration', 'family_gathering'
  ) then
    raise exception 'Invalid bundle occasion';
  end if;

  v_bundle_components := coalesce(bundle_components_param, '{}');
  if not (v_bundle_components <@ array[
    'dinner', 'something_to_do', 'finish_the_night',
    'something_fun', 'sweet_treat',
    'food', 'family_fun'
  ]::text[]) then
    raise exception 'Invalid bundle component';
  end if;
  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles,
    bundle_occasion, bundle_components
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15),
    bundle_occasion_param, v_bundle_components
  ) returning id into v_availability_id;

  for v_req in
    select br.*
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and (capacity_param is null or br.party_size is null or capacity_param >= br.party_size)
    and (category_param is null or br.category is null or br.category = category_param)
    and (
      br.date is null
      or br.date between starts_at_param::date and ends_at_param::date
    )
    and (
      br.date is null or br.time_window_start is null or br.time_window_end is null
      or (br.date + br.time_window_start, br.date + br.time_window_end) overlaps (starts_at_param, ends_at_param)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= least(br.radius_miles, coalesce(radius_miles_param, 15))
    order by br.created_at desc
    limit 10
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (v_req.id, v_partner_id, offer_type_param, coalesce(description_param, title_param), price_param, v_availability_id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;

      if coalesce((select notify_business from profiles where id = v_req.requester_id), true) then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_req.id);

        if v_occ_type is not null then
          v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
          v_push_body := trim(title_param) || ' just became available for your ' || lower(_occasion_noun(v_occ_type)) || ' request'
            || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
        else
          v_push_title := 'New offer for your request!';
          v_push_body := trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"';
        end if;

        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_req.requester_id,
            'title', v_push_title,
            'body', v_push_body,
            'data', jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id)
          )
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object('availabilityId', v_availability_id, 'matchedCount', v_matched_count);
end;
$function$
;

create or replace function public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric default null::numeric, proposed_time_param timestamp with time zone default null::timestamp with time zone, experience_id_param uuid default null::uuid, media_path_param text default null::text, media_type_param text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_price = offer_price_param,
      proposed_time = proposed_time_param,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      responded_at = now()
  where id = v_row.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into v_partner_name from brand_partners where id = v_partner_id;
  if coalesce((select notify_business from profiles where id = v_requester_id), true) then
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(request_id_param);

    if v_occ_type is not null then
      v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' responded to your ' || lower(_occasion_noun(v_occ_type)) || ' request'
        || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
    else
      v_push_title := 'New offer for your request!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' responded to "' || left(v_raw_text, 60) || '"';
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester_id,
        'title', v_push_title,
        'body', v_push_body,
        'data', jsonb_build_object('type', 'business_offer_received', 'request_id', request_id_param, 'offer_id', v_row.id)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$
;

-- ---------- New: "Your reservation ... is confirmed!" ----------
-- accept_business_offer only ever pushed the BUSINESS ("Your offer was
-- accepted!") -- the consumer who just tapped Accept, and whose real
-- occasion (if any) this reservation is for, never got their own
-- confirmation. service_key is now fetched once, unconditionally, so the
-- new consumer push doesn't depend on the business having any managing
-- profiles.

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
  v_reservation_id uuid;
  v_managing_profiles uuid[];
  service_key text;
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_consumer_title text;
  v_consumer_body text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
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

  update business_request_offers
  set status = 'accepted', accepted_at = now()
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  returning id into v_reservation_id;

  -- Real, honest routing: a payable Stripe PaymentIntent can only follow
  -- when there's a real price AND the business has genuinely finished
  -- Connect onboarding (stripe_charges_enabled) — otherwise this stays
  -- exactly the pre-Stripe 'not_required' state, never a fabricated
  -- pending charge nothing downstream can actually collect.
  select stripe_charges_enabled into v_stripe_ready
  from brand_partners where id = v_offer.partner_id;

  if v_offer.offer_price is not null and coalesce(v_stripe_ready, false) then
    v_payment_status := 'pending';
    v_payment_provider := 'stripe';
  else
    v_payment_status := 'not_required';
    v_payment_provider := null;
  end if;

  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider)
  values (v_reservation_id, v_payment_status, v_offer.offer_price, 'usd', auth.uid(), v_payment_provider);

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into v_partner_name from brand_partners where id = v_offer.partner_id;

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null and service_key is not null then
    for i in 1 .. array_length(v_managing_profiles, 1) loop
      continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
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

  if service_key is not null and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_request.id);

    if v_occ_type is not null then
      v_consumer_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
      if v_occ_who is not null then
        v_consumer_body := 'Your reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
      else
        v_consumer_body := 'Your ' || _occasion_noun(v_occ_type) || ' reservation is confirmed!';
      end if;
    else
      v_consumer_title := '✅ Reservation Confirmed!';
      v_consumer_body := 'Your reservation' || case when v_partner_name is not null then ' with ' || v_partner_name else '' end || ' is confirmed!';
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_request.requester_id,
        'title', v_consumer_title,
        'body', v_consumer_body,
        'data', jsonb_build_object('type', 'business_reservation_confirmed', 'request_id', v_request.id, 'offer_id', offer_id_param)
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$
;

-- ---------- confirm_group_plan_offer: fix self-exclusion, add occasion context ----------
-- Real bug: the final "everyone confirmed" loop excluded `auth.uid()` --
-- correct for the earlier "someone else confirmed, you should too" nudge
-- above it (the confirmer obviously doesn't need to be told to confirm),
-- wrong here, since it meant the participant whose own tap just finalized
-- the reservation was the one person who never learned it was confirmed.

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
  v_occ_type text;
  v_occ_who text;
  v_final_title text;
  v_final_body text;
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
        continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
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

  select occasion_type, who_for_name into v_occ_type, v_occ_who
  from _occasion_context_for_business_request(v_proposal.resulting_request_id);

  if v_occ_type is not null then
    v_final_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
    if v_occ_who is not null then
      v_final_body := 'Your group''s reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
    else
      v_final_body := 'Everyone confirmed -- your group''s ' || lower(_occasion_noun(v_occ_type)) || ' reservation is locked in.';
    end if;
  else
    v_final_title := 'Group plan reservation confirmed!';
    v_final_body := 'Everyone confirmed -- your group plan reservation is locked in.';
  end if;

  if service_key is not null then
    for v_notify_row in
      select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted'
    loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_notify_row.user_id,
          'title', v_final_title,
          'body', v_final_body,
          'data', jsonb_build_object('type', 'group_plan_reservation_confirmed', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true, 'allConfirmed', true, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count) || v_accept_result;
end;
$function$
;
