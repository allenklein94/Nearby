-- Notification categories (external UX critique item 29): replace the
-- growing, ungoverned pile of individual per-feature notify_* boolean
-- columns with 6 named categories a user actually controls -- Social,
-- Discovery, Proximity, Planning, Business, Community -- matching the
-- user's own locked spec (a concrete example given for each: "A new
-- event matches your interests" -> Discovery, "You crossed paths with
-- someone interesting" -> Proximity, "Your reservation is coming up" ->
-- Planning, "A place you were interested in has availability" ->
-- Business, "A community you're following posted something new" ->
-- Community). This also closes two real, previously *ungated* pushes
-- found while auditing every push-sending function for this change --
-- _accept_business_offer_internal/_business_request_fanout/
-- _match_request_to_availability/_match_request_to_policy/
-- accept_business_offer/admin_review_business_content_screening (offer-
-- response branch)/approve_business_partner_request/
-- deny_business_partner_request/notify_aggregated_demand_threshold/
-- post_business_availability/request_more_business_partner_info/
-- respond_to_business_partnership_request/_ai_auto_respond_to_business_requests
-- all fired unconditionally with no preference check at all before this
-- migration; they now gate on notify_business (all routed to a
-- business's own managing profile(s) or to the consumer who submitted
-- the underlying business_requests row -- see each function body below
-- for which). notify_community_area_demand_threshold gates on
-- notify_community (community leaders). cancel_community gains its
-- first-ever gate, also notify_community.
--
-- Mapping applied to every already-gated push below: notify_friends /
-- notify_dating / notify_messages / notify_waves -> notify_social;
-- notify_things_to_do / notify_nearby_opportunities -> notify_discovery
-- (their own separate frequency/distance/time-pref/categories knobs,
-- shipped 2026-09-11 for external UX critique item 17, are unchanged --
-- only the plain on/off master switch collapses into notify_discovery);
-- notify_crossed_paths -> notify_proximity; notify_plans ->
-- notify_planning; notify_businesses_offers -> notify_business.
--
-- Existing users' new category values are backfilled honestly from
-- whatever they'd already set on the old columns -- OR'd across every
-- constituent so a user who wanted *any* of the folded-in pushes keeps
-- getting all pushes in that now-shared category (the unavoidable cost
-- of consolidating), while someone who'd already turned every
-- constituent off stays off. notify_community has no predecessor and
-- defaults true for everyone via its own column default. The old,
-- fully-superseded plain on/off columns are dropped at the end -- no
-- code reads them after this migration; DROP COLUMN cascades any
-- dependent constraint automatically.

alter table profiles
  add column if not exists notify_social boolean not null default true,
  add column if not exists notify_discovery boolean not null default true,
  add column if not exists notify_proximity boolean not null default true,
  add column if not exists notify_planning boolean not null default true,
  add column if not exists notify_business boolean not null default true,
  add column if not exists notify_community boolean not null default true;

update profiles set
  notify_social = coalesce(notify_friends, true) or coalesce(notify_dating, true)
    or coalesce(notify_messages, true) or coalesce(notify_waves, true),
  notify_discovery = coalesce(notify_things_to_do, true) or coalesce(notify_nearby_opportunities, true),
  notify_proximity = coalesce(notify_crossed_paths, true),
  notify_planning = coalesce(notify_plans, true),
  notify_business = coalesce(notify_businesses_offers, true);

CREATE OR REPLACE FUNCTION public._accept_business_offer_internal(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._ai_auto_respond_to_business_requests(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_exp record;
  v_reason text;
  v_offer_price numeric;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bap.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name, p.ai_trust_level
    from business_ai_policies bap
    join brand_partners p on p.id = bap.partner_id and p.active = true
    left join reputation r on r.partner_id = bap.partner_id
    where bap.enabled = true
    and bap.action_type = 'auto_respond_offer'
    and p.ai_trust_level >= 2
    and bap.trust_level <= p.ai_trust_level
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bap.created_at desc
  loop
    v_reason := null;
    v_exp := null;

    if category_param is null or (v_policy.conditions ->> 'category') is distinct from category_param then
      v_reason := 'category_mismatch';
    elsif party_size_param is not null and v_policy.conditions ? 'party_size_max'
          and party_size_param > (v_policy.conditions ->> 'party_size_max')::integer then
      v_reason := 'party_size_out_of_range';
    elsif v_policy.conditions ? 'hours_start' and v_policy.conditions ? 'hours_end'
          and time_window_start_param is not null and time_window_end_param is not null
          and not ((time_window_start_param, time_window_end_param) overlaps
                    ((v_policy.conditions ->> 'hours_start')::time, (v_policy.conditions ->> 'hours_end')::time)) then
      v_reason := 'hours_mismatch';
    else
      select * into v_exp from business_experiences
      where id = (v_policy.conditions ->> 'experience_id')::uuid
      and partner_id = v_policy.partner_id and active = true;

      if v_exp.id is null then
        v_reason := 'experience_inactive';
      end if;
    end if;

    if v_reason is not null then
      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, requires_approval, approval_result, outcome
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('policy_name', v_policy.name),
        false, 'blocked', v_reason
      )
      on conflict (policy_id, (input_ref ->> 'request_id')) where approval_result = 'blocked' do nothing;
      continue;
    end if;

    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    v_offer_price := case v_exp.price_level
      when '$' then 15 when '$$' then 35 when '$$$' then 65 else null
    end;

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, actual_action, confidence, requires_approval, approval_result
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('experience_id', v_exp.id, 'experience_title', v_exp.title, 'price_level', v_exp.price_level),
        jsonb_build_object('offer_type', 'standard', 'offer_price', v_offer_price),
        null, false, 'auto_applied'
      );

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_policy.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your AI Automation auto-responded!',
              'body', 'Policy "' || v_policy.name || '" auto-sent an offer for: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return v_new_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  v_req_attributes text[];
  v_req_cuisine text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine into v_raw_text, v_req_attributes, v_req_cuisine from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, p.attributes, p.cuisine, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
    ),
    reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, e.id
    from eligible e
    left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      -- Real attribute/cuisine overlap with what this request actually
      -- asked for -- 0 (a no-op) whenever the request specified no
      -- attributes/cuisine at all, which is the common case today.
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
      -- Established (5+ real past opportunities) partners next, ranked
      -- by real completion rate. Everyone else (no row, or under the
      -- threshold) falls through in exactly their prior distance-only
      -- order -- completion_rate is null for them, "nulls last" keeps
      -- them as one undifferentiated group below the established ones.
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
    limit 10
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'A customer is asking for: "' || left(coalesce(v_raw_text, ''), 60) || '"',
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._match_request_to_availability(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, preferred_availability_id_param uuid DEFAULT NULL::uuid, party_size_param integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_availability_id_param is not null then
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    where ba.id = preferred_availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
      values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        if service_key is null then
          select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        end if;
        select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_preferred.partner_id;
        if v_managing_profiles is not null then
          for i in 1 .. array_length(v_managing_profiles, 1) loop
            continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
            perform net.http_post(
              url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
              headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
              body := jsonb_build_object(
                'recipient_id', v_managing_profiles[i],
                'title', 'Your availability was just matched!',
                'body', '"' || v_preferred.title || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_avail.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your availability was just matched!',
              'body', '"' || v_avail.title || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4). Priority order, now with the
  -- real party-size feasibility case inserted between the two existing
  -- capacity-adjacent reasons: an explicit category mismatch is still the
  -- most legible reason; then zero remaining capacity; then a real but
  -- insufficient remaining capacity for the requester's own party size;
  -- then, by elimination, a date/time overlap failure.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    ba.partner_id,
    'availability',
    case
      when category_param is not null and ba.category is not null and ba.category <> category_param then 'category_mismatch'
      when not (ba.remaining_capacity is null or ba.remaining_capacity > 0) then 'zero_capacity'
      when party_size_param is not null and ba.remaining_capacity is not null and ba.remaining_capacity < party_size_param then 'insufficient_capacity'
      else 'date_or_time_mismatch'
    end,
    ba.id
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= least(radius_miles_param, ba.radius_miles)
  and not (
    (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (party_size_param is null or ba.remaining_capacity is null or ba.remaining_capacity >= party_size_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and (date_param is null or date_param between ba.starts_at::date and ba.ends_at::date)
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
  )
  on conflict (request_id, partner_id, availability_id) where source = 'availability' do nothing;

  return v_new_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._match_request_to_policy(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, date into v_raw_text, v_request_date from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true
    left join reputation r on r.partner_id = bfp.partner_id
    where bfp.active = true
    and bfp.auto_accept_party_size_max is not null
    and p.latitude is not null and p.longitude is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bfp.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_policy.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Auto-accepted a new request!',
              'body', 'Your fulfillment policy auto-accepted: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Missed-match instrumentation: priority order stays the same reasoning
  -- as before -- can't auto-accept at all, then party size, then hours,
  -- then active days (the new predicate, inserted before weather so
  -- weather stays the real catch-all it already was), and by elimination
  -- weather is the only real predicate left once the first four all pass.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    bfp.partner_id,
    'policy',
    case
      when bfp.auto_accept_party_size_max is null then 'no_auto_accept'
      when not (
        (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
        and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
        and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
      ) then 'party_size_out_of_range'
      when not (
        bfp.active_hours_start is null or bfp.active_hours_end is null
        or time_window_start_param is null or time_window_end_param is null
        or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
      ) then 'hours_mismatch'
      when not (
        bfp.active_days is null or v_request_date is null
        or extract(dow from v_request_date)::smallint = any(bfp.active_days)
      ) then 'active_days_mismatch'
      else 'weather_unfavorable'
    end,
    null
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true
  where bfp.active = true
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  and not (
    bfp.auto_accept_party_size_max is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_offer.partner_id;
  if v_managing_profiles is not null then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
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

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_requester_id,
          'title', 'New offer for your request!',
          'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"',
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

CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  new_partner_id uuid;
  service_key text;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory, categories)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory, req.categories)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_partner_id = new_partner_id
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  if req.source = 'web' and req.applicant_phone is not null then
    select id into matched_profile_id from auth.users where phone = req.applicant_phone limit 1;
    if matched_profile_id is not null then
      perform public._claim_web_business_requests(matched_profile_id);
    end if;
  end if;

  if coalesce((select notify_business from profiles where id = req.requester_id), true) then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', req.requester_id,
        'title', 'You''re approved as a partner! 🎉',
        'body', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.',
        'data', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id)
      )
    );
  end if;

  return new_partner_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_name text;
  service_key text;
  member_row record;
begin
  select status, name into v_status, v_name from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This community is already cancelled.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'cancelled' where id = community_id_param;

  update business_requests set status = 'cancelled'
    where community_id = community_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where community_id = community_id_param)
      and status in ('pending', 'offered');

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for member_row in
    select user_id from community_members where community_id = community_id_param and user_id <> auth.uid()
  loop
    continue when not coalesce((select notify_community from profiles where id = member_row.user_id), true);
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', member_row.user_id,
        'title', 'A community was cancelled',
        'body', '"' || v_name || '" has been cancelled by its creator.',
        'data', jsonb_build_object('type', 'community_cancelled')
      )
    );
  end loop;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_mutual_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  matched_user_a uuid;
  matched_user_b uuid;
  new_match_id uuid;
  sender_name text;
  recipient_name text;
  to_user_wants_notif boolean;
  from_user_wants_notif boolean;
begin
  if exists (
    select 1 from notices
    where from_user = new.to_user and to_user = new.from_user
  ) then
    matched_user_a := least(new.from_user, new.to_user);
    matched_user_b := greatest(new.from_user, new.to_user);
    insert into matches (user_a, user_b)
    values (matched_user_a, matched_user_b)
    on conflict do nothing
    returning id into new_match_id;
    if new_match_id is not null then
      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      select display_name into sender_name from profiles where id = new.from_user;
      select display_name into recipient_name from profiles where id = new.to_user;

      select coalesce(notify_social, true) into to_user_wants_notif from profiles where id = new.to_user;
      select coalesce(notify_social, true) into from_user_wants_notif from profiles where id = new.from_user;

      if to_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.to_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(sender_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;

      if from_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.from_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(recipient_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_group_plan(proposal_id_param uuid, exclude_user_ids_param uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
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
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if service_key is not null then
    for v_notify_row in
      select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted' and user_id <> auth.uid()
    loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
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
$function$
;

CREATE OR REPLACE FUNCTION public.deny_business_partner_request(request_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  service_key text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can deny business partner requests';
  end if;

  update business_partner_requests
  set status = 'denied', reviewed_at = now(), reviewed_by = auth.uid()
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into business_acquisition_events (session_id, user_id, event)
  values (gen_random_uuid(), req.requester_id, 'apply_denied');

  if coalesce((select notify_business from profiles where id = req.requester_id), true) then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', req.requester_id,
        'title', 'Update on your partner application',
        'body', coalesce(
          nullif(req.admin_notes, ''),
          'Your application for "' || req.business_name || '" wasn''t approved this time. You can submit a new application any time.'
        ),
        'data', jsonb_build_object('type', 'business_partner_denied', 'request_id', request_id_param)
      )
    );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_next_recurring_gathering()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  past_recurring record;
  next_scheduled_at timestamptz;
  interval_step interval;
  new_gathering_id uuid;
  service_key text;
  past_attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for past_recurring in
    select g.*
    from gatherings g
    where g.recurring_series_id is not null
    and g.scheduled_at < now()
    and g.series_stopped = false
    and not exists (
      select 1 from gatherings g2
      where g2.recurring_series_id = g.recurring_series_id
      and g2.scheduled_at >= now()
    )
    and not exists (
      select 1 from gatherings g4
      where g4.recurring_series_id = g.recurring_series_id
      and g4.series_stopped = true
    )
    and g.id = (
      select g3.id from gatherings g3
      where g3.recurring_series_id = g.recurring_series_id
      order by g3.scheduled_at desc
      limit 1
    )
  loop
    interval_step := case past_recurring.recurrence_rule
      when 'weekly' then interval '7 days'
      when 'biweekly' then interval '14 days'
      when 'monthly' then interval '1 month'
      else null
    end;

    if interval_step is not null then
      -- Keep advancing by the interval until we land on a genuinely
      -- future date — if an instance was cancelled and this cron
      -- didn't run for a while, blindly adding one interval to the
      -- last known date could still land in the past.
      next_scheduled_at := past_recurring.scheduled_at + interval_step;
      while next_scheduled_at <= now() loop
        next_scheduled_at := next_scheduled_at + interval_step;
      end loop;

      insert into gatherings (
        host_id, title, description, interest_tag, area, scheduled_at, wide_area,
        is_public, show_on_map, women_only, community_id, hosting_partner_id,
        recurrence_rule, recurring_series_id
      )
      values (
        past_recurring.host_id, past_recurring.title, past_recurring.description, past_recurring.interest_tag,
        past_recurring.area, next_scheduled_at, past_recurring.wide_area,
        past_recurring.is_public, past_recurring.show_on_map, past_recurring.women_only,
        past_recurring.community_id, past_recurring.hosting_partner_id,
        past_recurring.recurrence_rule, past_recurring.recurring_series_id
      )
      returning id into new_gathering_id;

      for past_attendee in
        select distinct gi.user_id
        from gathering_interest gi
        where gi.gathering_id = past_recurring.id
        and gi.status = 'approved'
      loop
        if coalesce((select notify_planning from profiles where id = past_attendee.user_id), true) then
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', past_attendee.user_id,
              'title', '🔁 ' || past_recurring.title,
              'body', 'It''s happening again — tap to rejoin.',
              'data', jsonb_build_object('type', 'recurring_gathering', 'gathering_id', new_gathering_id)
            )
          );
        end if;
      end loop;
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_inviter_name text;
  v_gathering_title text;
  v_gathering_host_id uuid;
  v_women_only boolean;
  v_friend_gender text;
  v_is_friend boolean;
  v_is_blocked boolean;
  v_wants_notif boolean;
begin
  select exists(
    select 1 from friendships
    where status = 'accepted'
    and ((user_a = auth.uid() and user_b = friend_id_param) or (user_a = friend_id_param and user_b = auth.uid()))
  ) into v_is_friend;
  if not v_is_friend then
    raise exception 'You can only invite accepted friends';
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = auth.uid())
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited';
  end if;

  select host_id, title, women_only into v_gathering_host_id, v_gathering_title, v_women_only from gatherings where id = gathering_id_param;

  if v_women_only then
    select gender into v_friend_gender from profiles where id = friend_id_param;
    if lower(coalesce(v_friend_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = v_gathering_host_id and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = v_gathering_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited to this gathering';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), friend_id_param, 'gathering', gathering_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing;

  select coalesce((select notify_planning from profiles where id = friend_id_param), true) into v_wants_notif;
  if not v_wants_notif then
    return;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_inviter_name from profiles where id = auth.uid();
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', friend_id_param,
      'title', coalesce(v_inviter_name, 'A friend') || ' invited you to a gathering',
      'body', coalesce(v_gathering_title, 'Check it out') || ' — tap to see the details.',
      'data', jsonb_build_object('type', 'gathering_invite', 'gathering_id', gathering_id_param)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_aggregated_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_partner record;
  v_prior_count integer;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner in the same
    -- category, mirroring get_aggregated_demand_for_partner()'s own
    -- "within the requester's own radius_miles of the business" rule.
    select count(*) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as the group-intent trigger above --
    -- fires once when real nearby demand for this category first reaches
    -- 2, never again for the 3rd/4th/etc. request.
    if v_prior_count = 1 then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Growing demand nearby',
              'body', '2 or more people are now looking for ' || new.category || ' near ' || v_partner.name || '.',
              'data', jsonb_build_object('type', 'aggregated_demand_growing', 'partner_id', v_partner.id, 'category', new.category)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_business_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  partner_name text;
  follower record;
  follower_wants_notif boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into partner_name from brand_partners where id = new.partner_id;

  for follower in
    select user_id from business_followers where brand_partner_id = new.partner_id
  loop
    select coalesce(notify_business, true) into follower_wants_notif from profiles where id = follower.user_id;
    if not follower_wants_notif then
      continue;
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', follower.user_id,
        'title', coalesce(partner_name, 'Business') || ': ' || new.title,
        'body', coalesce(new.body, ''),
        'data', jsonb_build_object('type', 'business_update', 'partner_id', new.partner_id)
      )
    );
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_community_area_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_community record;
  v_prior_count integer;
  v_leader_ids uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_community in
    select c.id, c.name, c.area_lat, c.area_lng
    from communities c
    where c.interest_tag = new.category
    and c.area_lat is not null
    and c.area_lng is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(c.area_lat)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(c.area_lng)) +
        sin(radians(c.area_lat)) * sin(radians(new.latitude))
      ))
    )) <= 15
  loop
    -- Real count of other open requests near this community's own Area
    -- point in the same category -- same "count everything real within
    -- reach" shape the business-side trigger already uses.
    select count(*) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_community.area_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_community.area_lng)) +
          sin(radians(v_community.area_lat)) * sin(radians(br.latitude))
        ))
      )) <= 15;

    -- Same crossing-point-only rule as the business/group-intent triggers --
    -- fires once when real nearby demand for this category first reaches 2,
    -- never again for the 3rd/4th/etc. request.
    if v_prior_count = 1 then
      select array_agg(user_id) into v_leader_ids
      from community_members
      where community_id = v_community.id and role in ('creator', 'leader');

      if v_leader_ids is not null then
        for i in 1 .. array_length(v_leader_ids, 1) loop
          continue when not coalesce((select notify_community from profiles where id = v_leader_ids[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_leader_ids[i],
              'title', 'Growing demand near your community',
              'body', '2 or more people are now looking for ' || new.category || ' near ' || v_community.name || '.',
              'data', jsonb_build_object('type', 'community_area_demand_growing', 'community_id', v_community.id, 'category', new.category)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_constitution_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '📜 New entry added',
        'body', adder_name || ' added something to your Constitution',
        'data', jsonb_build_object('type', 'constitution_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_friend_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_requester_name text;
  v_recipient uuid;
  v_recipient_wants_notif boolean;
begin
  if new.status = 'pending' then
    v_recipient := case when new.user_a = new.requested_by then new.user_b else new.user_a end;
    select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = v_recipient;
    if not v_recipient_wants_notif then
      return new;
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_requester_name from profiles where id = new.requested_by;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_recipient,
        'title', 'New friend request',
        'body', coalesce(v_requester_name, 'Someone') || ' wants to be friends on Nearby.',
        'data', jsonb_build_object('type', 'friend_request')
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_friend_request_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_accepter_name text;
  v_requester uuid;
  v_requester_wants_notif boolean;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    v_requester := new.requested_by;
    select coalesce(notify_social, true) into v_requester_wants_notif from profiles where id = v_requester;
    if not v_requester_wants_notif then
      return new;
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_accepter_name from profiles where id = (case when new.requested_by = new.user_a then new.user_b else new.user_a end);

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester,
        'title', 'Friend request accepted',
        'body', coalesce(v_accepter_name, 'Someone') || ' accepted your friend request.',
        'data', jsonb_build_object('type', 'friend_accepted')
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_gathering_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  service_key text;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', case when old.status = 'waitlisted' then 'A spot opened up!' else 'You''re approved!' end,
          'body', case when old.status = 'waitlisted'
            then 'A spot opened up in "' || gathering_title || '" and you''re in! Start chatting!'
            else 'The host of "' || gathering_title || '" approved your interest. Start chatting!' end,
          'data', jsonb_build_object('type', 'gathering_approved', 'match_id', new.match_id)
        )
      );
    end if;
  elsif new.status = 'waitlisted' and old.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', 'Added to the waitlist',
          'body', '"' || gathering_title || '" is full, but you''re on the waitlist — we''ll let you know if a spot opens.',
          'data', jsonb_build_object('type', 'gathering_waitlisted', 'gathering_id', new.gathering_id)
        )
      );
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_gathering_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for attendee in
    select user_id from gathering_interest where gathering_id = old.id and status = 'approved'
  loop
    if coalesce((select notify_planning from profiles where id = attendee.user_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', attendee.user_id,
          'title', 'A gathering was cancelled',
          'body', '"' || old.title || '" has been cancelled by the host.',
          'data', jsonb_build_object('type', 'gathering_cancelled')
        )
      );
    end if;
  end loop;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_gathering_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_host_id uuid;
  gathering_title text;
  interested_user_name text;
  host_wants_notif boolean;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select host_id, title into gathering_host_id, gathering_title from gatherings where id = new.gathering_id;
  select display_name into interested_user_name from profiles where id = new.user_id;
  select coalesce(notify_planning, true) into host_wants_notif from profiles where id = gathering_host_id;

  if host_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', gathering_host_id,
        'title', 'New interest in your gathering',
        'body', interested_user_name || ' is interested in "' || gathering_title || '"',
        'data', jsonb_build_object('type', 'gathering_interest')
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_gathering_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  attendee record;
  time_changed boolean;
begin
  time_changed := old.scheduled_at is distinct from new.scheduled_at;

  -- Only notify for changes that actually matter to someone who's
  -- already committed to attending — a title tweak alone doesn't
  -- need to interrupt someone, but a time change genuinely does.
  if not time_changed and old.title = new.title then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for attendee in
    select gi.user_id from gathering_interest gi
    where gi.gathering_id = new.id and gi.status = 'approved'
  loop
    if coalesce((select notify_planning from profiles where id = attendee.user_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', attendee.user_id,
          'title', 'Gathering Updated',
          'body', case
            when time_changed then '"' || new.title || '" changed to a new time — tap to see details.'
            else '"' || new.title || '" was updated — tap to see details.'
          end,
          'data', jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.id)
        )
      );
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_group_intent_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_connected_user record;
  v_prior_count integer;
  v_wants_notif boolean;
begin
  if new.status <> 'open' or new.category is null then
    return new;
  end if;

  -- An opted-out requester's own new row should never count toward
  -- crossing anyone else's group-intent threshold either -- mirrors the
  -- read RPC's own filter exactly, not a separate rule.
  if not exists (
    select 1 from profiles where id = new.requester_id and intent_visibility = 'friends_and_matches'
  ) then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_connected_user in
    select case when f.user_a = new.requester_id then f.user_b else f.user_a end as user_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.requester_id or f.user_b = new.requester_id)
    union
    select case when m.user_a = new.requester_id then m.user_b else m.user_a end as user_id
    from matches m
    where m.user_a = new.requester_id or m.user_b = new.requester_id
  loop
    -- How many of THIS connected user's own connections already have a
    -- real open request in this category, not counting the new row?
    -- Mirrors get_my_group_intent_signals()'s own connected-set + real
    -- open/expiry/category/intent_visibility filters exactly.
    select count(distinct br.requester_id) into v_prior_count
    from business_requests br
    join profiles p2 on p2.id = br.requester_id
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.requester_id <> v_connected_user.user_id
      and p2.intent_visibility = 'friends_and_matches'
      and (
        exists (
          select 1 from friendships f2
          where f2.status = 'accepted'
          and ((f2.user_a = v_connected_user.user_id and f2.user_b = br.requester_id)
            or (f2.user_a = br.requester_id and f2.user_b = v_connected_user.user_id))
        )
        or exists (
          select 1 from matches m2
          where (m2.user_a = v_connected_user.user_id and m2.user_b = br.requester_id)
            or (m2.user_a = br.requester_id and m2.user_b = v_connected_user.user_id)
        )
      );

    -- Fire exactly once, at the real 1 -> 2 crossing -- never again for
    -- the 3rd/4th/etc. request in the same category, so this can't nag.
    if v_prior_count = 1 then
      select coalesce(notify_discovery, true) into v_wants_notif from profiles where id = v_connected_user.user_id;
      if v_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
          body := jsonb_build_object(
            'recipient_id', v_connected_user.user_id,
            'title', 'A few people you know want this too',
            'body', '2 or more people you''re connected to are looking for ' || new.category || ' right now.',
            'data', jsonb_build_object('type', 'group_intent_signal', 'category', new.category)
          )
        );
      end if;
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_matching_business_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_partner record;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_effective_radius double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_starts_local timestamp;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select id, name, latitude, longitude, subcategory, categories
    into v_partner
    from brand_partners bp
    where bp.id = new.partner_id;
  if v_partner.latitude is null or v_partner.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_nearby_opportunities_frequency, p.notify_nearby_opportunities_max_distance_miles,
           p.notify_nearby_opportunities_time_pref
    from profiles p
    join presence_reports pr on pr.user_id = p.id
    where coalesce(p.managed_partner_id, '00000000-0000-0000-0000-000000000000'::uuid) <> new.partner_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and (
        (new.category is not null and p.interests @> array[new.category])
        or (v_partner.subcategory is not null and p.interests @> array[v_partner.subcategory])
        or (v_partner.categories is not null and p.interests && v_partner.categories)
      )
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(v_partner.latitude)) * cos(radians(v_partner.longitude) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(v_partner.latitude))
    )));
    v_effective_radius := coalesce(new.radius_miles, 15);
    if v_candidate.notify_nearby_opportunities_max_distance_miles is not null then
      v_effective_radius := least(v_effective_radius, v_candidate.notify_nearby_opportunities_max_distance_miles);
    end if;
    if v_distance_miles > v_effective_radius then
      continue;
    end if;

    v_starts_local := new.starts_at at time zone v_candidate.tz;
    if v_candidate.notify_nearby_opportunities_time_pref = 'evenings_weekends'
       and extract(dow from v_starts_local) not in (0, 6)
       and extract(hour from v_starts_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'business_availability'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_nearby_opportunities_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🌟 This matches you',
        'body', coalesce(v_partner.name, 'A nearby business') || '''s "' || new.title || '" matches your interests.',
        'data', jsonb_build_object('type', 'recommended_business_availability', 'availability_id', new.id, 'partner_id', new.partner_id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'business_availability', new.id);
  end loop;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_matching_things_to_do()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_scheduled_local timestamp;
  v_when_phrase text;
begin
  if new.visibility <> 'everyone' or coalesce(new.is_public, false) is not true or new.interest_tag is null
     or new.precise_lat is null or new.precise_lng is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_things_to_do_frequency, p.notify_things_to_do_max_distance_miles,
           p.notify_things_to_do_time_pref
    from profiles p
    join presence_reports pr on pr.user_id = p.id
    where p.id <> new.host_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and p.interests @> array[new.interest_tag]
      and (p.notify_things_to_do_categories is null or new.interest_tag = any(p.notify_things_to_do_categories))
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(new.precise_lat)) * cos(radians(new.precise_lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(new.precise_lat))
    )));
    if v_candidate.notify_things_to_do_max_distance_miles is not null
       and v_distance_miles > v_candidate.notify_things_to_do_max_distance_miles then
      continue;
    end if;

    v_scheduled_local := new.scheduled_at at time zone v_candidate.tz;
    if v_candidate.notify_things_to_do_time_pref = 'evenings_weekends'
       and extract(dow from v_scheduled_local) not in (0, 6)
       and extract(hour from v_scheduled_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'gathering'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_things_to_do_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20 -- 'as_they_happen' -- still a hard safety ceiling, not literally unlimited
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    v_when_phrase := case
      when v_scheduled_local::date = v_today_in_tz and extract(hour from v_scheduled_local) >= 17 then 'tonight'
      when v_scheduled_local::date = v_today_in_tz then 'today'
      when v_scheduled_local::date = v_today_in_tz + 1 then 'tomorrow'
      when extract(dow from v_scheduled_local) in (0, 6) and v_scheduled_local::date <= v_today_in_tz + 7 then 'this weekend'
      else to_char(v_scheduled_local, 'FMDay')
    end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_candidate.id,
        'title', '🎯 This matches you',
        'body', '"' || new.title || '" (' || new.interest_tag || ') is happening ' || v_when_phrase || ' and matches your interests.',
        'data', jsonb_build_object('type', 'recommended_gathering', 'gathering_id', new.id)
      )
    );
    insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'gathering', new.id);
  end loop;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_memory_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '💫 New memory added',
        'body', adder_name || ' added something to your Memory Vault',
        'data', jsonb_build_object('type', 'memory_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  service_key text;
  sender_name text;
  notif_body text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;
  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into sender_name from profiles where id = new.sender_id;

  notif_body := case
    when new.audio_url is not null then 'Sent a voice message'
    when new.media_url is not null then 'Sent a photo'
    when new.gif_url is not null then 'Sent a GIF'
    when new.body is not null and new.body != '' then left(new.body, 100)
    else 'Sent a message'
  end;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', coalesce(sender_name, 'New message'),
        'body', notif_body,
        'data', jsonb_build_object('type', 'message', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_new_story()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  poster_name text;
  recipient record;
  already_posted_today boolean;
  poster_timezone text;
  poster_today_start timestamptz;
begin
  select coalesce(timezone, 'UTC') into poster_timezone from profiles where id = new.user_id;

  -- "Today" is now computed in the poster's own timezone, not the
  -- server's UTC default — same pattern already fixed for the daily
  -- AI/browse limits and birthday reminders.
  begin
    poster_today_start := date_trunc('day', now() at time zone poster_timezone) at time zone poster_timezone;
  exception when others then
    poster_today_start := date_trunc('day', now());
  end;

  select exists(
    select 1 from stories
    where user_id = new.user_id
    and id != new.id
    and created_at > poster_today_start
  ) into already_posted_today;

  if already_posted_today then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into poster_name from profiles where id = new.user_id;

  for recipient in
    select case when m.user_a = new.user_id then m.user_b else m.user_a end as recipient_id
    from matches m
    where m.user_a = new.user_id or m.user_b = new.user_id
    union
    select case when f.user_a = new.user_id then f.user_b else f.user_a end as recipient_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.user_id or f.user_b = new.user_id)
  loop
    if coalesce((select notify_social from profiles where id = recipient.recipient_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', recipient.recipient_id,
          'title', 'New Story',
          'body', coalesce(poster_name, 'Someone') || ' posted a new story.',
          'data', jsonb_build_object('type', 'new_story', 'story_user_id', new.user_id)
        )
      );
    end if;
  end loop;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_playlist_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🎵 New song added',
        'body', adder_name || ' added "' || new.song_title || '" to your shared playlist',
        'data', jsonb_build_object('type', 'playlist_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_screenshot_taken(match_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_taker_id uuid := auth.uid();
  v_recipient uuid;
  v_taker_name text;
  v_recipient_wants_notif boolean;
begin
  select case when m.user_a = v_taker_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_taker_id or m.user_b = v_taker_id);

  if v_recipient is null then
    return;
  end if;

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = v_recipient;
  if not v_recipient_wants_notif then
    return;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_taker_name from profiles where id = v_taker_id;

  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_recipient,
      'title', 'Screenshot taken',
      'body', coalesce(v_taker_name, 'Someone') || ' took a screenshot of your conversation.',
      'data', jsonb_build_object('type', 'screenshot', 'match_id', match_id_param)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_shared_decision_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧭 New thought shared',
        'body', adder_name || ' shared a thought in your Big Picture conversation',
        'data', jsonb_build_object('type', 'shared_decision_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_sighting_crossed_paths()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  name_a text;
  name_b text;
  a_wants_notif boolean;
  b_wants_notif boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into name_a from profiles where id = new.user_a;
  select display_name into name_b from profiles where id = new.user_b;

  select coalesce(notify_proximity, true) into a_wants_notif from profiles where id = new.user_a;
  select coalesce(notify_proximity, true) into b_wants_notif from profiles where id = new.user_b;

  if a_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_a,
        'title', 'You crossed paths! 👋',
        'body', 'You and ' || coalesce(name_b, 'someone nearby') || ' were near each other just now.',
        'data', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_b)
      )
    );
  end if;

  if b_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_b,
        'title', 'You crossed paths! 👋',
        'body', 'You and ' || coalesce(name_a, 'someone nearby') || ' were near each other just now.',
        'data', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_a)
      )
    );
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_stress_test_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧪 New "What If" thought',
        'body', adder_name || ' shared a thought on one of your scenarios',
        'data', jsonb_build_object('type', 'stress_test_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_super_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient_wants_notif boolean;
  service_key text;
  sender_name text;
begin
  if new.is_super = true then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select notify_social into recipient_wants_notif from profiles where id = new.to_user;
    select display_name into sender_name from profiles where id = new.from_user;
    if recipient_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.to_user,
          'title', coalesce(sender_name, 'Someone') || ' waved at you! 👋',
          'body', 'Open the app to see their profile.',
          'data', jsonb_build_object('type', 'wave')
        )
      );
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_timeline_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🗓️ New timeline thought',
        'body', adder_name || ' added a thought to your Timeline',
        'data', jsonb_build_object('type', 'timeline_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_trip_idea_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_social into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧳 New trip idea',
        'body', adder_name || ' added an idea to your trip plan',
        'data', jsonb_build_object('type', 'trip_idea_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_video_call_started(match_id_param uuid, call_kind text DEFAULT 'video'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_caller_id uuid := auth.uid();
  v_recipient uuid;
  v_caller_name text;
  v_recipient_wants_notif boolean;
begin
  select case when m.user_a = v_caller_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_caller_id or m.user_b = v_caller_id);

  if v_recipient is null then
    return;
  end if;

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = v_recipient;
  if not v_recipient_wants_notif then
    return;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_caller_name from profiles where id = v_caller_id;

  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_recipient,
      'title', coalesce(v_caller_name, 'Someone') || (case when call_kind = 'voice' then ' started a voice call' else ' started a video call' end),
      'body', 'Tap to join.',
      'data', jsonb_build_object('type', 'video_call', 'match_id', match_id_param, 'call_kind', call_kind)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_business_availability(category_param text, title_param text, description_param text, offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone, ends_at_param timestamp with time zone, radius_miles_param double precision DEFAULT 15, bundle_occasion_param text DEFAULT NULL::text, bundle_components_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_req record;
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
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_req.requester_id,
            'title', 'New offer for your request!',
            'body', trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"',
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

CREATE OR REPLACE FUNCTION public.propose_date(match_id_param uuid, plan_text_param text, availability_id_param uuid DEFAULT NULL::uuid, category_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_other_id), true) then
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
$function$
;

CREATE OR REPLACE FUNCTION public.propose_group_plan(source_request_id_param uuid, invitee_source_request_ids_param uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_wants_notif boolean;
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
    and not is_blocked(auth.uid(), br.requester_id)
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
      -- Not a real, still-open, genuinely-connected, unblocked, same-category
      -- request -- silently skipped rather than failing the whole
      -- proposal. The client only ever sources this list from
      -- get_connected_open_business_requests scoped to this same
      -- category (and, as of this fix, already block-filtered), so a
      -- mismatch here means the world changed between fetch and submit
      -- (e.g. it just got fulfilled, or a block was created), not an
      -- abuse attempt worth surfacing as a hard error.
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

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_request.requester_id;
    if service_key is not null and v_wants_notif then
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 RETURNS TABLE(is_mutual_match boolean, match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  v_friendship_id uuid;
  v_match_id uuid;
  v_reverse_like_exists boolean;
  v_i_opted_in boolean;
  v_they_opted_in boolean;
  v_already_connected boolean;
  v_my_name text;
  v_service_key text;
  v_recipient_wants_notif boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_me = target_user_id then
    raise exception 'You cannot swipe on yourself';
  end if;
  if direction_param not in ('like', 'pass') then
    raise exception 'Invalid direction';
  end if;

  perform id from profiles where id in (least(v_me, target_user_id), greatest(v_me, target_user_id)) order by id for update;

  select open_to_friend_discovery into v_i_opted_in from profiles where id = v_me;
  select open_to_friend_discovery into v_they_opted_in from profiles where id = target_user_id;
  if not coalesce(v_i_opted_in, false) or not coalesce(v_they_opted_in, false) then
    return query select false, null::uuid;
    return;
  end if;

  if is_blocked(v_me, target_user_id) then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friendships f
    where (f.user_a = v_me and f.user_b = target_user_id) or (f.user_a = target_user_id and f.user_b = v_me)
  ) or exists (
    select 1 from matches m
    where (m.user_a = v_me and m.user_b = target_user_id) or (m.user_a = target_user_id and m.user_b = v_me)
  ) into v_already_connected;

  if v_already_connected then
    return query select false, null::uuid;
    return;
  end if;

  insert into friend_discovery_swipes (from_user, to_user, direction)
  values (v_me, target_user_id, direction_param)
  on conflict (from_user, to_user) do nothing;

  if direction_param = 'pass' then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friend_discovery_swipes
    where from_user = target_user_id and to_user = v_me and direction = 'like'
  ) into v_reverse_like_exists;

  if not v_reverse_like_exists then
    return query select false, null::uuid;
    return;
  end if;

  v_user_a := least(v_me, target_user_id);
  v_user_b := greatest(v_me, target_user_id);

  perform set_config('app.trusted_update', 'true', true);

  insert into friendships (user_a, user_b, status, requested_by)
  values (v_user_a, v_user_b, 'accepted', v_me)
  on conflict (user_a, user_b) do update set status = 'accepted'
  where friendships.status <> 'accepted'
  returning id into v_friendship_id;

  if v_friendship_id is null then
    select id into v_friendship_id from friendships where user_a = v_user_a and user_b = v_user_b;
  end if;

  insert into matches (user_a, user_b, source_friendship_id)
  values (v_user_a, v_user_b, v_friendship_id)
  on conflict (user_a, user_b) do update
    set source_friendship_id = coalesce(matches.source_friendship_id, excluded.source_friendship_id)
  returning id into v_match_id;

  perform set_config('app.trusted_update', 'false', true);

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = target_user_id;
  if v_recipient_wants_notif then
    select display_name into v_my_name from profiles where id = v_me;
    select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', target_user_id,
        'title', 'New friend!',
        'body', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉',
        'data', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id)
      )
    );
  end if;

  return query select true, v_match_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_group_plan_participant(proposal_id_param uuid, target_user_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_participant record;
  service_key text;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can remove someone.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan can no longer be edited -- it has already been confirmed, cancelled, or expired.';
  end if;
  if target_user_id_param = auth.uid() then
    raise exception 'You can''t remove yourself -- cancel the group plan instead.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = target_user_id_param for update;
  if v_participant is null then
    raise exception 'That person is not part of this group plan.';
  end if;
  if v_participant.status = 'left' then
    raise exception 'That person has already left this group plan.';
  end if;

  update group_plan_participants
  set status = 'left', responded_at = coalesce(responded_at, now())
  where id = v_participant.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null and coalesce((select notify_planning from profiles where id = target_user_id_param), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', target_user_id_param,
        'title', 'You were removed from a group plan',
        'body', 'You''re no longer part of the ' || v_proposal.category || ' group plan.',
        'data', jsonb_build_object('type', 'group_plan_removed', 'proposal_id', proposal_id_param)
      )
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_more_business_partner_info(request_id_param uuid, notes_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  service_key text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review business partner requests';
  end if;

  if notes_param is null or trim(notes_param) = '' then
    raise exception 'A note is required so the applicant knows what to add.';
  end if;

  update business_partner_requests
  set status = 'needs_info', reviewed_at = now(), reviewed_by = auth.uid(), admin_notes = notes_param
  where id = request_id_param and status = 'pending'
  returning * into req;

  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  if coalesce((select notify_business from profiles where id = req.requester_id), true) then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', req.requester_id,
        'title', 'We need a bit more information',
        'body', notes_param,
        'data', jsonb_build_object('type', 'business_partner_needs_info', 'request_id', request_id_param)
      )
    );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_business_partnership_request(request_id_param uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  service_key text;
  v_business_name text;
  v_target_title text;
begin
  select * into v_request from business_partnership_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found';
  end if;

  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = v_request.partner_id) then
    raise exception 'Only the target business owner can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update business_partnership_requests
  set status = case when approve then 'approved' else 'declined' end, reviewed_at = now()
  where id = request_id_param;

  if approve then
    perform set_config('app.trusted_update', 'true', true);
    if v_request.target_type = 'gathering' then
      update gatherings set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    else
      update communities set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    end if;
  end if;

  select name into v_business_name from brand_partners where id = v_request.partner_id;
  if v_request.target_type = 'gathering' then
    select title into v_target_title from gatherings where id = v_request.target_id;
  else
    select name into v_target_title from communities where id = v_request.target_id;
  end if;

  if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_request.requester_id,
        'title', case when approve then coalesce(v_business_name, 'A business') || ' accepted your partnership request' else coalesce(v_business_name, 'A business') || ' declined your partnership request' end,
        'body', coalesce(v_target_title, 'Your gathering'),
        'data', jsonb_build_object('type', 'business_partnership_response', 'target_type', v_request.target_type, 'target_id', v_request.target_id)
      )
    );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_date_proposal(proposal_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_proposal.proposed_by), true) then
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_group_plan(proposal_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_participant record;
  service_key text;
  v_responder_name text;
  v_wants_notif boolean;
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

  if is_blocked(auth.uid(), v_proposal.initiator_id) then
    raise exception 'This group plan is no longer available.';
  end if;

  update group_plan_participants
  set status = case when accept_param then 'accepted' else 'declined' end, responded_at = now()
  where id = v_participant.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_responder_name from profiles where id = auth.uid();
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_proposal.initiator_id;
  if service_key is not null and v_wants_notif then
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_social_offer(offer_id_param uuid, accept_param boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer_id uuid;
  v_offerer_id uuid;
  service_key text;
  v_requester_name text;
begin
  select so.id, so.offerer_id
  into v_offer_id, v_offerer_id
  from social_offers so
  join business_requests br on br.id = so.request_id
  where so.id = offer_id_param
  and br.requester_id = auth.uid()
  and so.status = 'offered'
  for update of so;

  if v_offer_id is null then
    raise exception 'Offer not found or already responded to.';
  end if;

  update social_offers
  set status = case when accept_param then 'accepted' else 'declined' end,
      responded_at = now()
  where id = v_offer_id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_requester_name from profiles where id = auth.uid();
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_offerer_id), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_offerer_id,
        'title', case when accept_param then 'Your offer was accepted! 🎉' else 'An update on your offer' end,
        'body', coalesce(v_requester_name, 'Someone') || case when accept_param then ' accepted your offer.' else ' went a different way this time -- thanks for offering.' end,
        'data', jsonb_build_object('type', 'social_offer_responded', 'offer_id', v_offer_id, 'accepted', accept_param)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_birthday_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  birthday_person record;
  connection record;
  v_today_in_their_tz date;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for birthday_person in
    select id, display_name, birthdate, coalesce(timezone, 'UTC') as timezone from profiles
    where birthdate is not null
  loop
    -- Each person's "today" is computed in their own timezone, not
    -- the server's — otherwise this cron could fire a day early or
    -- late depending on how far someone's local time differs from
    -- wherever the database server actually runs.
    begin
      v_today_in_their_tz := (now() at time zone birthday_person.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
    end;

    if extract(month from birthday_person.birthdate) = extract(month from v_today_in_their_tz)
    and extract(day from birthday_person.birthdate) = extract(day from v_today_in_their_tz) then

      for connection in
        select case when m.user_a = birthday_person.id then m.user_b else m.user_a end as connection_id
        from matches m
        where m.user_a = birthday_person.id or m.user_b = birthday_person.id
        union
        select case when f.user_a = birthday_person.id then f.user_b else f.user_a end as connection_id
        from friendships f
        where f.status = 'accepted' and (f.user_a = birthday_person.id or f.user_b = birthday_person.id)
      loop
        if coalesce((select notify_social from profiles where id = connection.connection_id), true) then
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', connection.connection_id,
              'title', '🎂 Birthday Today',
              'body', 'It''s ' || coalesce(birthday_person.display_name, 'a connection') || '''s birthday today!',
              'data', jsonb_build_object('type', 'birthday', 'birthday_user_id', birthday_person.id)
            )
          );
        end if;
      end loop;
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_first_mission_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  candidate record;
  v_today_in_their_tz date;
  v_signup_date_in_their_tz date;
  v_days_since_signup integer;
  v_has_said_yes boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for candidate in
    select id, display_name, created_at, coalesce(timezone, 'UTC') as timezone, coalesce(notify_discovery, true) as wants_notif from profiles
  loop
    if not candidate.wants_notif then
      continue;
    end if;

    begin
      v_today_in_their_tz := (now() at time zone candidate.timezone)::date;
      v_signup_date_in_their_tz := (candidate.created_at at time zone candidate.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
      v_signup_date_in_their_tz := candidate.created_at::date;
    end;

    v_days_since_signup := v_today_in_their_tz - v_signup_date_in_their_tz;

    -- A narrow 3-4 day window, checked daily — fires exactly once
    -- per person rather than repeating every day someone remains
    -- inactive, which would feel naggy rather than encouraging.
    if v_days_since_signup in (3, 4) then
      select exists (
        select 1 from gathering_interest gi
        where gi.user_id = candidate.id
        and gi.status = 'approved'
        and gi.created_at >= candidate.created_at
      ) into v_has_said_yes;

      if not v_has_said_yes then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', candidate.id,
            'title', 'Your mission is still waiting',
            'body', 'Say yes to one thing this week — there''s still time.',
            'data', jsonb_build_object('type', 'first_mission_reminder')
          )
        );
      end if;
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_gathering_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  g record;
  attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for g in
    select id, host_id, title, scheduled_at
    from gatherings
    where reminder_sent = false
      and scheduled_at > now()
      and scheduled_at <= now() + interval '2 hours'
  loop
    -- Notify the host
    if coalesce((select notify_planning from profiles where id = g.host_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', g.host_id,
          'title', 'Your gathering starts soon',
          'body', '"' || g.title || '" starts in about 2 hours.',
          'data', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id)
        )
      );
    end if;

    -- Notify every approved attendee
    for attendee in
      select user_id from gathering_interest where gathering_id = g.id and status = 'approved'
    loop
      if coalesce((select notify_planning from profiles where id = attendee.user_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', attendee.user_id,
            'title', 'Gathering starting soon',
            'body', '"' || g.title || '" starts in about 2 hours.',
            'data', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id)
          )
        );
      end if;
    end loop;

    update gatherings set reminder_sent = true where id = g.id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_match_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  m record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for m in
    select mt.id, mt.user_a, mt.user_b, mt.matched_at,
           a.display_name as a_name, b.display_name as b_name,
           a.notify_social as a_wants_notif, b.notify_social as b_wants_notif
    from matches mt
    join profiles a on a.id = mt.user_a
    join profiles b on b.id = mt.user_b
    where mt.matched_at < now() - interval '24 hours'
      and mt.reminder_sent_at is null
      and not exists (select 1 from messages msg where msg.match_id = mt.id)
  loop
    if m.a_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', m.user_a,
          'title', 'Say hi to ' || coalesce(m.b_name, 'your match') || '! 👋',
          'body', 'You matched a day ago — send the first message.',
          'data', jsonb_build_object('type', 'match_reminder', 'match_id', m.id)
        )
      );
    end if;

    if m.b_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', m.user_b,
          'title', 'Say hi to ' || coalesce(m.a_name, 'your match') || '! 👋',
          'body', 'You matched a day ago — send the first message.',
          'data', jsonb_build_object('type', 'match_reminder', 'match_id', m.id)
        )
      );
    end if;

    update matches set reminder_sent_at = now() where id = m.id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_momentum_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  u record;
  wk int;
  week_has_activity boolean;
  streak int;
  current_week_activity boolean;
  redemption_count int;
  next_tier_min int;
  next_tier_name text;
  next_tier_emoji text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for u in select id, display_name, coalesce(notify_discovery, true) as wants_notif from profiles loop
    if not u.wants_notif then
      continue;
    end if;

    -- ---------- streak signal (mirrors getMomentumStats' weekly-bucket logic) ----------
    -- Consecutive completed weeks (not counting the current, still-in-progress
    -- week) with at least one attended-or-hosted gathering, counting back up
    -- to 8 weeks — same lookback window the Momentum screen itself uses.
    streak := 0;
    for wk in 1..8 loop
      select exists (
        select 1 from gathering_interest gi
        join gatherings g on g.id = gi.gathering_id
        where gi.user_id = u.id and gi.status = 'approved'
          and g.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
        union
        select 1 from gatherings g2
        where g2.host_id = u.id
          and g2.scheduled_at >= date_trunc('week', now()) - (wk || ' weeks')::interval
          and g2.scheduled_at < date_trunc('week', now()) - ((wk - 1) || ' weeks')::interval
      ) into week_has_activity;

      exit when not week_has_activity;
      streak := streak + 1;
    end loop;

    select exists (
      select 1 from gathering_interest gi
      join gatherings g on g.id = gi.gathering_id
      where gi.user_id = u.id and gi.status = 'approved' and g.scheduled_at >= date_trunc('week', now())
      union
      select 1 from gatherings g2
      where g2.host_id = u.id and g2.scheduled_at >= date_trunc('week', now())
    ) into current_week_activity;

    if streak >= 2 and not current_week_activity then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', u.id,
          'title', '🔥 Keep your streak going',
          'body', 'You''ve been active ' || streak || ' weeks in a row — join or host something this week to keep it up.',
          'data', jsonb_build_object('type', 'momentum_streak_nudge')
        )
      );
      continue; -- one nudge per person per run; don't also send the tier nudge below
    end if;

    -- ---------- reward-tier-proximity signal (mirrors getMyRewardStatus) ----------
    select count(*) into redemption_count from offer_redemptions where user_id = u.id;

    select min, name, emoji into next_tier_min, next_tier_name, next_tier_emoji
    from (values (5, 'Bronze', '🥉'), (15, 'Silver', '🥈'), (30, 'Gold', '🥇')) as tiers(min, name, emoji)
    where tiers.min > redemption_count
    order by tiers.min asc
    limit 1;

    if next_tier_min is not null and (next_tier_min - redemption_count) <= 2 then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', u.id,
          'title', next_tier_emoji || ' Almost at ' || next_tier_name,
          'body', (next_tier_min - redemption_count) || ' more redemption' || (case when (next_tier_min - redemption_count) = 1 then '' else 's' end) || ' and you''re ' || next_tier_name || '.',
          'data', jsonb_build_object('type', 'reward_tier_nudge')
        )
      );
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_group_plan_budget(proposal_id_param uuid, agreed_budget_max_param integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        continue when not coalesce((select notify_planning from profiles where id = v_notify_id), true);
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
$function$
;

CREATE OR REPLACE FUNCTION public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, experience_id_param uuid DEFAULT NULL::uuid, media_path_param text DEFAULT NULL::text, media_type_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
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
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_requester_id,
      'title', 'New offer for your request!',
      'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(v_raw_text, 60) || '"',
      'data', jsonb_build_object('type', 'business_offer_received', 'request_id', request_id_param, 'offer_id', v_row.id)
    )
  );
  end if;

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_social_offer(request_id_param uuid, offer_description_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_offer_id uuid;
  v_eligible boolean;
  service_key text;
  v_offerer_name text;
begin
  if offer_description_param is null or length(trim(offer_description_param)) = 0 then
    raise exception 'Describe what you can offer.';
  end if;

  select * into v_request from business_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id = auth.uid() then
    raise exception 'You cannot make a social offer on your own request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select (
    not is_blocked(auth.uid(), v_request.requester_id)
    and (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_request.requester_id) or (f.user_a = v_request.requester_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_request.requester_id) or (m.user_a = v_request.requester_id and m.user_b = auth.uid())
      )
      or exists (
        select 1 from community_members cm1
        join community_members cm2 on cm1.community_id = cm2.community_id
        where cm1.user_id = auth.uid() and cm2.user_id = v_request.requester_id
      )
      or exists (
        select 1
        from (
          select gathering_id from gathering_interest where user_id = auth.uid() and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = auth.uid()
        ) mine
        join (
          select gathering_id from gathering_interest where user_id = v_request.requester_id and status = 'approved'
          union
          select id as gathering_id from gatherings where host_id = v_request.requester_id
        ) theirs on mine.gathering_id = theirs.gathering_id
      )
    )
  ) into v_eligible;

  if not v_eligible then
    raise exception 'You need to already be connected to this person to make them an offer.';
  end if;

  insert into social_offers (request_id, offerer_id, offer_description, status)
  values (request_id_param, auth.uid(), trim(offer_description_param), 'offered')
  on conflict (request_id, offerer_id) do update
    set offer_description = excluded.offer_description, status = 'offered',
        responded_at = null, viewed_at = null, created_at = now()
    where social_offers.status in ('withdrawn', 'declined', 'expired', 'cancelled')
  returning id into v_offer_id;

  if v_offer_id is null then
    raise exception 'You already made an offer on this request.';
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_offerer_name from profiles where id = auth.uid();
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_request.requester_id), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_request.requester_id,
        'title', 'Someone offered to help!',
        'body', coalesce(v_offerer_name, 'Someone you know') || ' made you a social offer: "' || left(trim(offer_description_param), 60) || '"',
        'data', jsonb_build_object('type', 'social_offer_received', 'request_id', request_id_param, 'offer_id', v_offer_id)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'offerId', v_offer_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where id = offer_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'Offer not found.';
  end if;
  if v_row.status <> 'offered' then
    raise exception 'This offer can no longer be withdrawn.';
  end if;

  update business_request_offers
  set status = 'withdrawn', responded_at = now()
  where id = offer_id_param;

  select requester_id, raw_text into v_requester_id, v_raw_text
  from business_requests where id = v_row.request_id;
  select name into v_partner_name from brand_partners where id = v_partner_id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if coalesce((select notify_business from profiles where id = v_requester_id), true) then
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_requester_id,
      'title', 'An offer was withdrawn',
      'body', coalesce(v_partner_name, 'A business') || ' withdrew its offer on "' || left(v_raw_text, 60) || '"',
      'data', jsonb_build_object('type', 'business_offer_withdrawn', 'request_id', v_row.request_id, 'offer_id', offer_id_param)
    )
  );
  end if;

  return jsonb_build_object('success', true);
end;
$function$
;


-- The old plain on/off columns are now fully superseded -- every push
-- gate above reads from the 6 new columns; nothing left reads these.
alter table profiles
  drop column if exists notify_friends,
  drop column if exists notify_dating,
  drop column if exists notify_messages,
  drop column if exists notify_waves,
  drop column if exists notify_crossed_paths,
  drop column if exists notify_plans,
  drop column if exists notify_things_to_do,
  drop column if exists notify_nearby_opportunities,
  drop column if exists notify_businesses_offers;
