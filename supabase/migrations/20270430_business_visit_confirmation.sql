-- Business visit confirmation (owner decisions 2026-11-21; STAGED on post-tier1/visit-confirmation, never production
-- without its own approval). PRODUCT_AUDIT/BUSINESS_WEB_PARITY_AUDIT_2026-11-21.md + VISIT_CONFIRMATION_PROGRESS_2026-11-21.md.
--
-- Before: complete_business_reservation let the customer OR the business set an offer to 'completed', recorded nobody as
-- the confirmer, and only the customer's screen ever called it. Every business figure counting 'completed' (reputation,
-- performance, funnel, value, routing track record, reliability, analytics) therefore counted customer self-marks as visits.
--
-- After (backward compatible; 'completed' is NOT redefined):
--   * business_request_offers.customer_done_at   = the customer's own "Mark as done" (personal only).
--   * business_request_offers.visit_confirmed_at = the business's "Confirm visit" (the ONLY confirmed visit).
--     Neither is client-writable (the table has no UPDATE policy); both are readable by whoever can already read the row.
--   * status 'completed' keeps meaning "done by someone": plans this month, plan status, plan stops, "How was it?",
--     account deletion and every booked-state reader (accepted|completed) are unchanged.
--   * complete_business_reservation (same signature; builds <= 87 keep working):
--       - the request's requester -> personal mark (always, even if they also manage the business: no self-confirmed
--         visits); sets customer_done_at; completes status/plan as before if still accepted; no OFFER_REDEEMED.
--       - the business (selected location = the offer's business) -> confirmation; sets visit_confirmed_at; completes
--         status/plan if still accepted; emits OFFER_REDEEMED (record-only event, moved here).
--       - both idempotent (repeat = success, nothing changed), both refused after a no-show, visit-day rule unchanged.
--   * mark_business_no_show: refused once the visit is confirmed; allowed after a customer's own mark (the business is
--     authoritative). Both functions lock the offer row first, so a confirmation and a no-show can never both exist.
--   * Verified-visit readers switched from status 'completed' to visit_confirmed_at (list below). Not touched: sponsored
--     refunds (sponsored_placements' own status), Stripe/edge functions (no completion dependency), _learn_from_redemption.
--   * Existing completed rows get neither column (who completed them is unknown): never counted as confirmed.

alter table public.business_request_offers
  add column if not exists customer_done_at timestamptz,
  add column if not exists visit_confirmed_at timestamptz;

create or replace function public.complete_business_reservation(offer_id_param uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer record;
  v_request record;
  v_reservation record;
  v_partner_id uuid;
  v_is_requester boolean;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  -- Who may act is decided before anything about its state: the requester or the business that made the offer.
  select * into v_request from business_requests where id = v_offer.request_id;
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if auth.uid() is null or (auth.uid() is distinct from v_request.requester_id and (v_partner_id is null or v_partner_id <> v_offer.partner_id)) then
    raise exception 'You are not part of this reservation.';
  end if;
  -- The requester's call is always their own personal mark, even when they also manage the business.
  v_is_requester := auth.uid() = v_request.requester_id;

  -- Idempotent per side: a repeat is success and changes nothing (no second timestamp, plan update or event).
  if v_is_requester and v_offer.customer_done_at is not null then
    return jsonb_build_object('success', true, 'alreadyCompleted', true, 'personal', true);
  end if;
  if not v_is_requester and v_offer.visit_confirmed_at is not null then
    return jsonb_build_object('success', true, 'alreadyCompleted', true, 'confirmed', true);
  end if;

  if v_offer.status not in ('accepted', 'completed') then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;
  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;
  if exists (select 1 from business_visit_no_shows where offer_id = offer_id_param) then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  -- Owner decision 2026-10-11 (1): never before the scheduled visit date.
  if not public._visit_local_day_reached(offer_id_param) then
    raise exception 'You can mark this as completed on the day of the visit.';
  end if;

  if v_is_requester then
    update business_request_offers set customer_done_at = now() where id = offer_id_param;
  else
    update business_request_offers set visit_confirmed_at = now() where id = offer_id_param;
  end if;

  -- The first completion by either side moves the booking to 'completed' (as before) and completes the Plan.
  if v_offer.status = 'accepted' then
    update business_request_offers
    set status = 'completed', completed_at = now()
    where id = offer_id_param;

    -- Completing the primary booking completes the Plan (an add-on's reservation does not complete the whole plan).
    if not exists (select 1 from business_requests where id = v_offer.request_id and parent_request_id is not null) then
      update plans set status = 'completed'
      where resulting_business_request_id = v_offer.request_id and status = 'confirmed';
    end if;
  end if;

  -- Item 125: recorded only (no redemption push). Only a business confirmation is a redemption.
  if not v_is_requester then
    perform public._emit_event('OFFER_REDEEMED', 'business_request_offer', offer_id_param, auth.uid(), 'complete_business_reservation',
      jsonb_build_object('request_id', v_offer.request_id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param,
                         'reservation_id', v_reservation.id),
      'OFFER_REDEEMED:' || offer_id_param);
  end if;

  return jsonb_build_object('success', true, 'personal', v_is_requester, 'confirmed', not v_is_requester);
end;
$function$;

-- mark_business_no_show: refused once the visit is confirmed; allowed after a customer's personal mark.
CREATE OR REPLACE FUNCTION public.mark_business_no_show(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_reservation record;
  v_partner uuid;
  v_visit timestamptz;
begin
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_partner is null or v_partner <> v_offer.partner_id then
    raise exception 'This visit is not one of yours.';
  end if;
  if exists (select 1 from business_visit_no_shows where offer_id = offer_id_param) then
    return jsonb_build_object('marked', false, 'already', true);
  end if;
  -- A customer's own "Mark as done" never stops the business recording a no-show (the business is authoritative);
  -- a visit the business already confirmed can't also be a no-show.
  if v_offer.visit_confirmed_at is not null or v_offer.status not in ('accepted', 'completed') then
    raise exception 'Only a confirmed visit that was not completed can be marked as a no-show.';
  end if;
  select * into v_reservation from business_reservations where offer_id = offer_id_param;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'Only a confirmed visit that was not completed can be marked as a no-show.';
  end if;
  v_visit := _visit_starts_at(offer_id_param);
  if v_visit is null then
    raise exception 'This visit has no time on record, so it cannot be marked as a no-show.';
  end if;
  if now() < v_visit then
    raise exception 'You can mark a no-show once the visit time has passed.';
  end if;
  insert into business_visit_no_shows (offer_id, reservation_id, request_id, partner_id, visit_at, marked_by)
  values (offer_id_param, v_reservation.id, v_offer.request_id, v_offer.partner_id, v_visit, auth.uid());
  return jsonb_build_object('marked', true);
end;
$function$;
-- _ai_auto_respond_to_business_requests: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public._ai_auto_respond_to_business_requests(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
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
        round(100.0 * count(*) filter (where visit_confirmed_at is not null) / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
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
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at, auto_reply
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now(), 'ai'
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now(), auto_reply = excluded.auto_reply
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

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'ai_auto_respond',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id, 'policy_id', v_policy.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  return v_new_count;
end;
$function$;

-- _business_request_fanout: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_req_attributes text[];
  v_req_dietary text[];
  v_req_cuisine text;
  v_req_occasion text;
  v_req_category text;
  v_req_group text;
  v_req_party integer;
  v_children boolean;
  v_pets boolean;
  v_outdoor boolean;
  v_consider double precision;
  v_cands jsonb;
  v_decision bigint;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select attributes, cuisine, occasion, category, party_size, dietary
    into v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category, v_req_party, v_req_dietary
  from business_requests where id = request_id_param;
  -- Category-aware routing (20270130): a request whose category maps to a group only reaches businesses in that
  -- group (declared tags or major). No category / unmapped category = unfiltered, as before. Deterministic, no AI.
  v_req_group := public.request_category_group(v_req_category);
  -- the same request facts _business_declines_request derives (used only to name the reason, never to decide)
  v_children := coalesce(v_req_attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
  v_pets := coalesce(v_req_attributes, '{}') && array['dog_friendly', 'pet_friendly'];
  v_outdoor := 'outdoor_seating' = any(coalesce(v_req_attributes, '{}'));
  v_consider := least(greatest(radius_miles_param * 2, radius_miles_param + 10), 100);

  with considered as (
    select p.id, p.attributes, p.dietary_options, p.cuisine, p.offered_occasions, p.max_group_size,
           p.private_room_capacity, p.outdoor_capacity,
           (3958.8 * acos(least(1.0, greatest(-1.0,
              cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
              sin(radians(latitude_param)) * sin(radians(p.latitude)))))) as distance_miles,
           ((category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
             and (business_major_filter_param is null or p.category = business_major_filter_param)
             and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))) as cat_ok,
           -- item 86: a business that declared something this request conflicts with is never routed it
           public._business_declines_request(p.id, request_id_param) as declines,
           (v_req_party is not null and p.max_group_size is not null and p.max_group_size < v_req_party) as cap_small,
           (public._business_declines(p.id, null, v_children, v_pets, v_outdoor, false, false) is not null) as other_conflict,
           -- item 116 step 2: known closed at the requested time (declared hours / temporary closure), with no live posting covering it
           public._business_closed_for_request(p.id, request_id_param) as closed_then,
           -- item 116 check 7: the request's per-person budget is below the business's declared minimum spend (both known)
           public._business_below_min_spend(p.id, request_id_param) as below_min
    from brand_partners p
    where p.active = true and p.latitude is not null and p.longitude is not null
  ),
  near as (select * from considered where distance_miles <= v_consider),
  reputation as (
    select partner_id, count(*) as total_opportunities,
           round(100.0 * count(*) filter (where visit_confirmed_at is not null)
                 / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
    from business_request_offers group by partner_id
  ),
  scored as (
    select e.*, r.total_opportunities, r.completion_rate,
      -- item 80: a business whose DECLARED largest group is below the party size goes last (strongly de-prioritized, not removed)
      -- item 81: or the space the request asks for (private room / outdoor area, only while that capability is declared) is too small
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size < v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity < v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity < v_req_party))) as k_deprio,
      -- a business that explicitly says it offers this occasion is routed the request first
      (v_req_occasion is not null and v_req_occasion = any(e.offered_occasions)) as k_occ,
      -- a business that serves the exact requested tag (a coffee shop for a coffee request) goes ahead of group-only matches
      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) as k_exact,
      -- item 80: a declared largest group that covers the party goes ahead of an unknown one
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size >= v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity >= v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity >= v_req_party))) as k_fits,
      -- item 88: a business that declared every dietary need of the request goes ahead of one that did not say
      (cardinality(coalesce(v_req_dietary, '{}')) > 0 and coalesce(e.dietary_options, '{}') @> v_req_dietary) as k_diet,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) as k_overlap,
      -- item 116 check 6: the request clearly matches something the business said it wants more of (rank only, never eligibility)
      public._business_wants_request(e.id, request_id_param) as k_want,
      (r.total_opportunities is not null and r.total_opportunities >= 5) as k_established
    from near e
    left join reputation r on r.partner_id = e.id
    where e.cat_ok and not e.declines and not e.closed_then and not e.below_min and e.distance_miles <= radius_miles_param
  ),
  ranked as (
    select s.*, row_number() over (order by
      s.k_deprio asc, s.k_occ desc, s.k_exact desc, s.k_fits desc, s.k_diet desc, s.k_overlap desc, s.k_want desc, s.k_established desc,
      s.completion_rate desc nulls last, s.distance_miles asc, s.id asc) as rn
    from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'distance', round(n.distance_miles::numeric, 2), 'rn', k.rn,
      'reasons', array(select x from unnest(array[
          case when n.distance_miles > radius_miles_param then 'outside_geo_range' end,
          case when not n.cat_ok then 'wrong_category' end,
          case when n.declines and (n.other_conflict or not n.cap_small) then 'restriction_conflict' end,
          case when n.declines and n.cap_small then 'capacity_too_small' end,
          case when n.closed_then then 'unavailable' end,  -- the audit's existing code for this
          case when n.below_min then 'below_minimum_spend' end,
          case when k.rn > 10 then 'below_routing_cutoff' end]) x where x is not null),
      'signals', array(select x from unnest(array[
          case when k.k_occ then 'occasion_offered' end,
          case when k.k_exact then 'exact_tag' end,
          case when k.k_fits then 'group_size_fits' end,
          case when k.k_deprio then 'deprioritized_size' end,
          case when k.k_diet then 'dietary_all_declared' end,
          case when k.k_overlap > 0 then 'attribute_match' end,
          case when k.k_want then 'wants_more' end,
          case when k.k_established then 'established_record' end]) x where x is not null),
      'sort_key', case when k.id is not null then jsonb_build_object(
          'deprioritized_size', k.k_deprio, 'occasion_offered', k.k_occ, 'exact_tag', k.k_exact, 'group_size_fits', k.k_fits,
          'dietary_all_declared', k.k_diet, 'attribute_overlap', k.k_overlap, 'wants_more', k.k_want, 'established_record', k.k_established,
          'completion_rate', k.completion_rate, 'distance_miles', round(k.distance_miles::numeric, 2)) end,
      'in_range', n.distance_miles <= radius_miles_param) order by k.rn nulls last, n.distance_miles), '[]'::jsonb)
  into v_cands
  from near n left join ranked k on k.id = n.id;

  perform set_config('app.routing_path', 'fanout', true);
  for v_row in
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, (c->>'id')::uuid
    from jsonb_array_elements(v_cands) c
    where (c->>'rn')::int <= 10
    order by (c->>'rn')::int
    returning id, partner_id
  loop
    v_notified_count := v_notified_count + 1;

    -- Item 125: one BUSINESS_REQUEST_SENT per business reached; the notification layer decides urgent push vs digest.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_row.id,
      (select requester_id from business_requests where id = request_id_param), 'fanout',
      jsonb_build_object('request_id', request_id_param, 'partner_id', v_row.partner_id, 'offer_id', v_row.id, 'directed', false),
      'BUSINESS_REQUEST_SENT:' || v_row.id);
  end loop;
  perform set_config('app.routing_path', '', true);

  -- The audit: never blocks routing. A failure is recorded and routing continues unchanged.
  begin
    insert into routing_decisions (request_id, path, rules_version, request_radius_miles, consideration_radius_miles,
                                   request_snapshot, considered_count, in_range_count, eligible_count, chosen_count)
    values (request_id_param, 'fanout', _routing_rules_version('fanout'), radius_miles_param, v_consider,
            _routing_request_snapshot(request_id_param) || jsonb_build_object(
              'category_filter', category_filter_param, 'major_filter', business_major_filter_param),
            jsonb_array_length(v_cands),
            (select count(*) from jsonb_array_elements(v_cands) c where (c->>'in_range')::boolean),
            (select count(*) from jsonb_array_elements(v_cands) c where c->>'rn' is not null),
            v_notified_count)
    returning id into v_decision;
    insert into routing_candidates (decision_id, partner_id, outcome, rank, primary_reason, reason_codes, signals, sort_key, distance_miles)
    select v_decision, (c->>'id')::uuid,
           case when (c->>'rn')::int <= 10 then 'chosen' else 'excluded' end,
           (c->>'rn')::int,
           case when (c->>'rn')::int <= 10 then null else c->'reasons'->>0 end,
           case when (c->>'rn')::int <= 10 then '{}'::text[] else array(select jsonb_array_elements_text(c->'reasons')) end,
           array(select jsonb_array_elements_text(c->'signals')),
           c->'sort_key', (c->>'distance')::numeric
    from jsonb_array_elements(v_cands) c;
  exception when others then
    perform _routing_record_failure(request_id_param, 'fanout', sqlerrm);
  end;

  return v_notified_count;
end;
$function$;

-- _match_request_to_availability_core: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public._match_request_to_availability_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, preferred_availability_id_param uuid DEFAULT NULL::uuid, party_size_param integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_bound integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  -- Idea "384" (2026-10-24): the chosen posting is bound by ONE helper, shared with the exclusive (targeted) path.
  if preferred_availability_id_param is not null then
    v_bound := public._bind_preferred_posting(request_id_param, preferred_availability_id_param, latitude_param, longitude_param, radius_miles_param, party_size_param);
    if v_bound > 0 then
      v_new_count := v_new_count + v_bound;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where visit_confirmed_at is not null) / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
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

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_availability',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_avail.partner_id, 'availability_id', v_avail.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id));
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
  join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
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
$function$;

-- _match_request_to_policy_core: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public._match_request_to_policy_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
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
        round(100.0 * count(*) filter (where visit_confirmed_at is not null) / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
      and not public._business_closed_for_request(p.id, request_id_param)
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

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at, auto_reply)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now(), 'policy'
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now(),
          auto_reply = excluded.auto_reply
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_policy',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
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
      when public._business_closed_for_request(bfp.partner_id, request_id_param) then 'hours_mismatch'  -- item 116: known closed then
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
  join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
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
    and not public._business_closed_for_request(bfp.partner_id, request_id_param)
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

-- get_market_validation_stats: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_market_validation_stats()
 RETURNS TABLE(distinct_submitters bigint, returned_7d bigint, return_rate_7d numeric, returned_30d bigint, return_rate_30d numeric, partners_with_opportunities bigint, total_opportunities bigint, responded_count bigint, response_rate numeric, accepted_count bigint, acceptance_rate numeric, completed_count bigint, completion_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view market validation stats';
  end if;

  return query
  with per_user as (
    select user_id, min(created_at) as first_at, max(created_at) as last_at
    from intent_submissions
    group by user_id
  )
  select
    (select count(*) from per_user),
    (select count(*) from per_user where last_at >= first_at + interval '7 days'),
    round(100.0 * (select count(*) from per_user where last_at >= first_at + interval '7 days') / nullif((select count(*) from per_user), 0), 1),
    (select count(*) from per_user where last_at >= first_at + interval '30 days'),
    round(100.0 * (select count(*) from per_user where last_at >= first_at + interval '30 days') / nullif((select count(*) from per_user), 0), 1),
    (select count(distinct partner_id) from business_request_offers),
    (select count(*) from business_request_offers),
    (select count(*) from business_request_offers where responded_at is not null),
    round(100.0 * (select count(*) from business_request_offers where responded_at is not null) / nullif((select count(*) from business_request_offers), 0), 1),
    (select count(*) from business_request_offers where status in ('accepted', 'completed')),
    round(100.0 * (select count(*) from business_request_offers where status in ('accepted', 'completed')) / nullif((select count(*) from business_request_offers where responded_at is not null), 0), 1),
    (select count(*) from business_request_offers where visit_confirmed_at is not null),
    round(100.0 * (select count(*) from business_request_offers where visit_confirmed_at is not null) / nullif((select count(*) from business_request_offers where status in ('accepted', 'completed')), 0), 1);
end;
$function$;

-- get_marketplace_reliability_rankings: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_marketplace_reliability_rankings()
 RETURNS TABLE(partner_id uuid, partner_name text, total_opportunities bigint, response_rate numeric, acceptance_rate numeric, completion_rate numeric, median_response_minutes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view marketplace reliability rankings';
  end if;

  return query
  select
    p.id,
    p.name,
    count(o.id) as total_opportunities,
    round(100.0 * count(o.id) filter (where o.responded_at is not null) / nullif(count(o.id), 0), 1) as response_rate,
    round(100.0 * count(o.id) filter (where o.status in ('accepted', 'completed')) / nullif(count(o.id) filter (where o.responded_at is not null), 0), 1) as acceptance_rate,
    round(100.0 * count(o.id) filter (where o.visit_confirmed_at is not null) / nullif(count(o.id) filter (where o.status in ('accepted', 'completed')), 0), 1) as completion_rate,
    round(cast(percentile_cont(0.5) within group (
      order by extract(epoch from (o.responded_at - o.created_at)) / 60.0
    ) filter (where o.responded_at is not null) as numeric), 0) as median_response_minutes
  from brand_partners p
  join business_request_offers o on o.partner_id = p.id
  group by p.id, p.name
  having count(o.id) >= 5
  order by completion_rate desc nulls last, acceptance_rate desc nulls last
  limit 20;
end;
$function$;

-- get_partner_category_outcomes: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_partner_category_outcomes(partner_id_param uuid)
 RETURNS TABLE(category text, total_opportunities bigint, response_rate numeric, acceptance_rate numeric, completion_rate numeric, rated_count bigint, pct_satisfied numeric, pct_would_repeat numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  if not coalesce((public.check_business_entitlement(partner_id_param, 'category_outcomes') ->> 'enabled')::boolean, false) then
    raise exception 'ENTITLEMENT_REQUIRED:category_outcomes';
  end if;

  return query
  select
    coalesce(br.category, 'Uncategorized') as category,
    count(*) as total_opportunities,
    round(100.0 * count(*) filter (where bro.responded_at is not null) / nullif(count(*), 0), 1) as response_rate,
    round(100.0 * count(*) filter (where bro.status in ('accepted', 'completed')) / nullif(count(*) filter (where bro.responded_at is not null), 0), 1) as acceptance_rate,
    round(100.0 * count(*) filter (where bro.visit_confirmed_at is not null) / nullif(count(*) filter (where bro.status in ('accepted', 'completed')), 0), 1) as completion_rate,
    count(distinct boo.id) as rated_count,
    round(100.0 * count(distinct boo.id) filter (where boo.satisfaction_rating in ('loved_it', 'good')) / nullif(count(distinct boo.id), 0), 1) as pct_satisfied,
    round(100.0 * count(distinct boo.id) filter (where boo.would_repeat in ('yes', 'maybe')) / nullif(count(distinct boo.id), 0), 1) as pct_would_repeat
  from business_request_offers bro
  join business_requests br on br.id = bro.request_id
  left join business_offer_outcomes boo on boo.offer_id = bro.id
  where bro.partner_id = partner_id_param
  group by coalesce(br.category, 'Uncategorized')
  having count(*) >= 5
  order by count(*) desc;
end;
$function$;

-- get_partner_offer_funnel: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_partner_offer_funnel(partner_id_param uuid)
 RETURNS TABLE(opportunities bigint, offers_sent bigint, accepted bigint, redemptions bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz := date_trunc('month', now());
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  select
    (select count(*) from business_request_offers o
      where o.partner_id = partner_id_param and o.created_at >= v_start),
    (select count(distinct e.offer_id) from business_lifecycle_events e
      join business_request_offers o on o.id = e.offer_id
      where o.partner_id = partner_id_param and e.object_kind = 'offer' and e.to_status = 'offered' and e.at >= v_start),
    (select count(*) from business_request_offers o
      where o.partner_id = partner_id_param and o.accepted_at >= v_start),
    (select count(*) from business_request_offers o
      where o.partner_id = partner_id_param and o.visit_confirmed_at is not null and o.visit_confirmed_at >= v_start);
end;
$function$;

-- get_partner_offer_performance: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_partner_offer_performance(partner_id_param uuid)
 RETURNS TABLE(group_key text, group_label text, offer_count bigint, accepted_count bigint, completed_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select
    coalesce(bro.experience_id::text, 'offer_type:' || coalesce(bro.offer_type, 'standard')) as group_key,
    coalesce(be.title, initcap(replace(coalesce(min(bro.offer_type), 'standard'), '_', ' '))) as group_label,
    count(*)::bigint as offer_count,
    count(*) filter (where bro.status in ('accepted', 'completed'))::bigint as accepted_count,
    count(*) filter (where bro.visit_confirmed_at is not null)::bigint as completed_count
  from business_request_offers bro
  left join business_experiences be on be.id = bro.experience_id
  where bro.partner_id = partner_id_param
    and bro.status in ('offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed')
  group by
    coalesce(bro.experience_id::text, 'offer_type:' || coalesce(bro.offer_type, 'standard')),
    be.title
  order by offer_count desc;
end;
$function$;

-- get_partner_offer_reputation: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_partner_offer_reputation(partner_id_param uuid)
 RETURNS TABLE(total_opportunities bigint, responded_count bigint, response_rate numeric, accepted_count bigint, acceptance_rate numeric, completed_count bigint, completion_rate numeric, rated_count bigint, pct_satisfied numeric, pct_would_repeat numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*),
    count(*) filter (where bro.responded_at is not null),
    round(100.0 * count(*) filter (where bro.responded_at is not null) / nullif(count(*), 0), 1),
    count(*) filter (where bro.status in ('accepted', 'completed')),
    round(100.0 * count(*) filter (where bro.status in ('accepted', 'completed')) / nullif(count(*) filter (where bro.responded_at is not null), 0), 1),
    count(*) filter (where bro.visit_confirmed_at is not null),
    round(100.0 * count(*) filter (where bro.visit_confirmed_at is not null) / nullif(count(*) filter (where bro.status in ('accepted', 'completed')), 0), 1),
    count(boo.id),
    round(100.0 * count(boo.id) filter (where boo.satisfaction_rating in ('loved_it', 'good')) / nullif(count(boo.id), 0), 1),
    round(100.0 * count(boo.id) filter (where boo.would_repeat = 'yes') / nullif(count(boo.id), 0), 1)
  from business_request_offers bro
  left join business_offer_outcomes boo on boo.offer_id = bro.id
  where bro.partner_id = partner_id_param;
$function$;

-- get_partner_offer_value: verified-visit counts read visit_confirmed_at (booked = accepted|completed unchanged)
CREATE OR REPLACE FUNCTION public.get_partner_offer_value(partner_id_param uuid)
 RETURNS TABLE(month_redemptions bigint, month_value numeric, month_unpriced bigint, all_redemptions bigint, all_value numeric, all_unpriced bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  with done as (
    select o.visit_confirmed_at as completed_at,
      case
        when o.offer_price is null then null
        when o.price_is_per_person then case when coalesce(o.proposed_party_size, r.party_size) is null then null else o.offer_price * coalesce(o.proposed_party_size, r.party_size) end
        else o.offer_price
      end as value
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where o.partner_id = partner_id_param and o.visit_confirmed_at is not null
  )
  select
    count(*) filter (where completed_at >= date_trunc('month', now())),
    coalesce(sum(value) filter (where completed_at >= date_trunc('month', now())), 0),
    count(*) filter (where completed_at >= date_trunc('month', now()) and value is null),
    count(*),
    coalesce(sum(value), 0),
    count(*) filter (where value is null)
  from done;
end;
$function$;

-- view request_journey
create or replace view public.request_journey as
SELECT r.id AS request_id,
    r.created_at AS requested_at,
    r.status AS request_status,
    r.area_key,
    r.category,
    r.occasion,
    r.party_size,
    r.date,
    r.time_window_start,
    r.budget_max,
    r.radius_miles,
    r.target_partner_id IS NOT NULL AS targeted,
        CASE
            WHEN r.gathering_id IS NOT NULL THEN 'gathering'::text
            WHEN r.match_id IS NOT NULL THEN 'match'::text
            WHEN r.community_id IS NOT NULL THEN 'community'::text
            WHEN r.group_plan_id IS NOT NULL THEN 'group_plan'::text
            WHEN r.parent_request_id IS NOT NULL THEN 'addon'::text
            ELSE 'solo'::text
        END AS request_source,
    r.submission_id,
    ask.id AS ask_snapshot_id,
    ask.surface AS ask_surface,
    ask.created_at AS asked_at,
    ask.interpretation AS ask_interpretation,
    ask.result_count AS ask_results_shown,
    ( SELECT count(*) AS count
           FROM typed_ask_snapshots s2
          WHERE s2.parent_snapshot_id = ask.id) AS ask_refinements,
    ( SELECT min(tr."position") AS min
           FROM typed_ask_results tr
          WHERE tr.snapshot_id = ask.id AND tr.partner_id = r.target_partner_id) AS targeted_business_shown_at,
    ( SELECT count(*) AS count
           FROM routing_decisions d
          WHERE d.request_id = r.id) AS routing_decisions,
    ( SELECT sum(d.considered_count) AS sum
           FROM routing_decisions d
          WHERE d.request_id = r.id) AS candidates_considered,
    ( SELECT sum(d.chosen_count) AS sum
           FROM routing_decisions d
          WHERE d.request_id = r.id) AS candidates_chosen,
    ( SELECT jsonb_object_agg(x.reason, x.n) AS jsonb_object_agg
           FROM ( SELECT c.primary_reason AS reason,
                    count(*) AS n
                   FROM routing_decisions d
                     JOIN routing_candidates c ON c.decision_id = d.id
                  WHERE d.request_id = r.id AND c.outcome = 'excluded'::text
                  GROUP BY c.primary_reason) x) AS excluded_by_reason,
    ( SELECT jsonb_agg(jsonb_build_object('partner_id', c.partner_id, 'path', d.path, 'rank', c.rank, 'distance_miles', c.distance_miles, 'signals', c.signals) ORDER BY d.created_at, c.rank) AS jsonb_agg
           FROM routing_decisions d
             JOIN routing_candidates c ON c.decision_id = d.id
          WHERE d.request_id = r.id AND c.outcome = 'chosen'::text) AS chosen_businesses,
    ( SELECT count(*) AS count
           FROM business_request_offers o
          WHERE o.request_id = r.id) AS offers_total,
    ( SELECT count(*) AS count
           FROM business_request_offers o
          WHERE o.request_id = r.id AND o.responded_at IS NOT NULL) AS offers_answered,
    ( SELECT jsonb_object_agg(x.status, x.n) AS jsonb_object_agg
           FROM ( SELECT o.status,
                    count(*) AS n
                   FROM business_request_offers o
                  WHERE o.request_id = r.id
                  GROUP BY o.status) x) AS offers_by_status,
    ( SELECT jsonb_object_agg(x.reason, x.n) AS jsonb_object_agg
           FROM ( SELECT o.decline_reason AS reason,
                    count(*) AS n
                   FROM business_request_offers o
                  WHERE o.request_id = r.id AND o.decline_reason IS NOT NULL
                  GROUP BY o.decline_reason) x) AS declines_by_reason,
    ( SELECT min(o.responded_at) AS min
           FROM business_request_offers o
          WHERE o.request_id = r.id) AS first_response_at,
    win.id AS booked_offer_id,
    win.partner_id AS booked_partner_id,
    win.accepted_at,
    ( SELECT c.distance_miles
           FROM routing_decisions d
             JOIN routing_candidates c ON c.decision_id = d.id
          WHERE d.request_id = r.id AND c.partner_id = win.partner_id
          ORDER BY d.created_at
         LIMIT 1) AS booked_distance_miles,
    res.status AS reservation_status,
    win.visit_confirmed_at AS completed_at,
    ns.marked_at AS no_show_marked_at,
    ( SELECT ce.reason_code
           FROM cancellation_events ce
          WHERE ce.entity_type = 'business_reservation'::text AND ce.entity_id = res.id OR ce.entity_type = 'business_request'::text AND ce.entity_id = r.id
          ORDER BY ce.created_at DESC
         LIMIT 1) AS cancellation_reason,
    ( SELECT oo.match_fit
           FROM business_offer_outcomes oo
          WHERE oo.offer_id = win.id
          ORDER BY oo.created_at DESC
         LIMIT 1) AS match_fit,
        CASE
            WHEN win.visit_confirmed_at IS NOT NULL THEN 'completed'::text
            WHEN ns.offer_id IS NOT NULL THEN 'no_show'::text
            WHEN win.id IS NOT NULL AND (win.status = 'cancelled'::text OR res.status = 'cancelled'::text) THEN 'reservation_cancelled'::text
            WHEN win.id IS NOT NULL THEN 'booked'::text
            WHEN r.status = 'cancelled'::text THEN 'request_cancelled'::text
            WHEN r.status = 'merged'::text THEN 'merged'::text
            WHEN r.status = 'expired'::text AND (EXISTS ( SELECT 1
               FROM business_request_offers o
              WHERE o.request_id = r.id AND (o.status = ANY (ARRAY['offered'::text, 'expired'::text])) AND o.responded_at IS NOT NULL)) THEN 'expired_with_offers'::text
            WHEN r.status = 'expired'::text THEN 'expired_no_offer'::text
            WHEN (EXISTS ( SELECT 1
               FROM business_request_offers o
              WHERE o.request_id = r.id AND o.status = 'offered'::text)) THEN 'offers_waiting'::text
            WHEN (EXISTS ( SELECT 1
               FROM business_request_offers o
              WHERE o.request_id = r.id AND o.status = 'pending'::text)) THEN 'awaiting_business'::text
            WHEN NOT (EXISTS ( SELECT 1
               FROM business_request_offers o
              WHERE o.request_id = r.id)) THEN 'not_routed'::text
            ELSE 'all_declined'::text
        END AS journey_outcome,
    ( SELECT count(*) AS count
           FROM business_request_offers o
          WHERE o.request_id = r.id AND (o.accepted_at IS NOT NULL OR o.responded_at IS NOT NULL AND o.status <> 'declined'::text OR (EXISTS ( SELECT 1
                   FROM business_lifecycle_events e
                  WHERE e.object_kind = 'offer'::text AND e.offer_id = o.id AND e.to_status = 'offered'::text)))) AS offers_made,
    ( SELECT min(LEAST(o.responded_at, ( SELECT min(e.at) AS min
                   FROM business_lifecycle_events e
                  WHERE e.object_kind = 'offer'::text AND e.offer_id = o.id AND e.to_status = 'offered'::text))) AS min
           FROM business_request_offers o
          WHERE o.request_id = r.id AND (o.accepted_at IS NOT NULL OR o.responded_at IS NOT NULL AND o.status <> 'declined'::text OR (EXISTS ( SELECT 1
                   FROM business_lifecycle_events e
                  WHERE e.object_kind = 'offer'::text AND e.offer_id = o.id AND e.to_status = 'offered'::text)))) AS first_offer_at,
    date_trunc('week'::text, (r.created_at AT TIME ZONE 'UTC'::text))::date AS request_week
   FROM business_requests r
     LEFT JOIN LATERAL ( SELECT s.id,
            s.user_id,
            s.submission_id,
            s.surface,
            s.rules_version,
            s.outcome,
            s.interpretation,
            s.candidate_count,
            s.exclusions,
            s.result_count,
            s.created_at,
            s.parent_snapshot_id,
            s.refinement_key,
            s.refinement_action
           FROM typed_ask_snapshots s
          WHERE r.submission_id IS NOT NULL AND s.submission_id = r.submission_id AND s.parent_snapshot_id IS NULL
          ORDER BY s.created_at
         LIMIT 1) ask ON true
     LEFT JOIN LATERAL ( SELECT o.id,
            o.request_id,
            o.partner_id,
            o.offer_type,
            o.offer_price,
            o.offer_description,
            o.proposed_time,
            o.created_at,
            o.expires_at,
            o.responded_at,
            o.accepted_at,
            o.completed_at,
            o.visit_confirmed_at,
            o.status,
            o.availability_id,
            o.viewed_at,
            o.decline_reason,
            o.decline_note,
            o.experience_id,
            o.media_path,
            o.media_type,
            o.cancelled_at,
            o.package_id,
            o.offer_title,
            o.included_items,
            o.price_is_per_person,
            o.discount_pct,
            o.is_directed,
            o.redemption_instructions,
            o.media_poster_path,
            o.creative_id,
            o.valid_until,
            o.available_from,
            o.available_until
           FROM business_request_offers o
          WHERE o.request_id = r.id AND o.accepted_at IS NOT NULL
          ORDER BY (o.status = ANY (ARRAY['accepted'::text, 'completed'::text])) DESC, o.accepted_at DESC
         LIMIT 1) win ON true
     LEFT JOIN business_reservations res ON res.offer_id = win.id
     LEFT JOIN business_visit_no_shows ns ON ns.offer_id = win.id;

-- view routing_candidate_outcomes
create or replace view public.routing_candidate_outcomes as
SELECT d.id AS decision_id,
    d.request_id,
    d.path,
    d.rules_version,
    d.created_at AS decided_at,
    c.partner_id,
    c.outcome AS routing_outcome,
    c.rank,
    c.primary_reason,
    c.reason_codes,
    c.signals,
    o.id AS offer_id,
    o.status AS offer_status,
    o.created_at AS offer_created_at,
    o.responded_at,
    o.accepted_at,
    o.visit_confirmed_at AS completed_at,
    o.cancelled_at,
    o.decline_reason,
    r.status AS request_status,
    res.status AS reservation_status,
    ( SELECT ce.reason_code
           FROM cancellation_events ce
          WHERE ce.entity_type = 'business_reservation'::text AND ce.entity_id = res.id OR ce.entity_type = 'business_request'::text AND ce.entity_id = d.request_id
          ORDER BY ce.created_at DESC
         LIMIT 1) AS cancellation_reason,
    ( SELECT oo.match_fit
           FROM business_offer_outcomes oo
          WHERE oo.offer_id = o.id
          ORDER BY oo.created_at DESC
         LIMIT 1) AS match_fit,
        CASE
            WHEN c.outcome = 'excluded'::text THEN 'not_routed'::text
            WHEN o.id IS NULL THEN 'no_offer_row'::text
            WHEN o.visit_confirmed_at IS NOT NULL THEN 'completed'::text
            WHEN o.status = 'accepted'::text AND (EXISTS ( SELECT 1
               FROM business_visit_no_shows n
              WHERE n.offer_id = o.id)) THEN 'no_show'::text
            WHEN o.status = 'accepted'::text THEN 'accepted'::text
            WHEN o.status = 'offered'::text THEN 'offer_sent'::text
            WHEN o.status = 'pending'::text AND r.status = 'open'::text THEN 'awaiting_business'::text
            WHEN o.status = 'pending'::text THEN 'no_response'::text
            ELSE o.status
        END AS chain_outcome
   FROM routing_decisions d
     JOIN routing_candidates c ON c.decision_id = d.id
     JOIN business_requests r ON r.id = d.request_id
     LEFT JOIN business_request_offers o ON o.request_id = d.request_id AND o.partner_id = c.partner_id
     LEFT JOIN business_reservations res ON res.offer_id = o.id;

-- view intent_funnel
create or replace view public.intent_funnel as
WITH asks AS (
         SELECT DISTINCT ON ((COALESCE(s.submission_id, s.id))) s.id,
            s.user_id,
            s.submission_id,
            s.surface,
            s.rules_version,
            s.created_at,
            s.interpretation
           FROM typed_ask_snapshots s
          WHERE s.parent_snapshot_id IS NULL
          ORDER BY (COALESCE(s.submission_id, s.id)), s.created_at, s.id
        ), fam AS (
         SELECT a_1.id AS ask_id,
            s.id AS snapshot_id,
            s.created_at
           FROM asks a_1
             JOIN typed_ask_snapshots s ON s.id = a_1.id OR s.parent_snapshot_id = a_1.id OR a_1.submission_id IS NOT NULL AND s.submission_id = a_1.submission_id
        ), req AS (
         SELECT a_1.id AS ask_id,
            br.id AS request_id,
            br.created_at
           FROM asks a_1
             JOIN business_requests br ON a_1.submission_id IS NOT NULL AND br.submission_id = a_1.submission_id AND br.requester_id = a_1.user_id
        )
 SELECT a.id AS ask_snapshot_id,
    a.submission_id,
    a.surface,
    a.rules_version,
    a.created_at AS asked_at,
    date_trunc('week'::text, a.created_at)::date AS ask_week,
    sub.wide_area AS ask_area,
    COALESCE(a.interpretation ->> 'category'::text, sub.category) AS category,
    ( SELECT count(*) AS count
           FROM fam f
          WHERE f.ask_id = a.id AND f.snapshot_id <> a.id) AS refinements,
    ( SELECT min(f.created_at) AS min
           FROM fam f
          WHERE f.ask_id = a.id AND (EXISTS ( SELECT 1
                   FROM typed_ask_results r
                  WHERE r.snapshot_id = f.snapshot_id))) AS shown_at,
    (EXISTS ( SELECT 1
           FROM fam f
             JOIN typed_ask_results r ON r.snapshot_id = f.snapshot_id
          WHERE f.ask_id = a.id AND r.result_type = 'gathering'::text)) AS showed_gathering,
    ( SELECT min(o.selected_at) AS min
           FROM intent_outcomes o
          WHERE o.user_id = a.user_id AND ((o.snapshot_id IN ( SELECT f.snapshot_id
                   FROM fam f
                  WHERE f.ask_id = a.id)) OR o.snapshot_id IS NULL AND a.submission_id IS NOT NULL AND o.submission_id = a.submission_id)) AS viewed_at,
    ( SELECT min(x.at) AS min
           FROM ( SELECT gi.created_at AS at,
                    gi.gathering_id
                   FROM gathering_interested gi
                  WHERE gi.user_id = a.user_id
                UNION ALL
                 SELECT j.interested_at,
                    j.gathering_id
                   FROM gathering_interested_joins j
                  WHERE j.user_id = a.user_id) x
          WHERE x.at >= a.created_at AND (x.gathering_id::text IN ( SELECT r.result_id
                   FROM fam f
                     JOIN typed_ask_results r ON r.snapshot_id = f.snapshot_id
                  WHERE f.ask_id = a.id AND r.result_type = 'gathering'::text))) AS interested_at,
    ( SELECT min(g.created_at) AS min
           FROM gathering_interest g
          WHERE g.user_id = a.user_id AND g.status = 'approved'::text AND g.created_at >= a.created_at AND (g.gathering_id::text IN ( SELECT r.result_id
                   FROM fam f
                     JOIN typed_ask_results r ON r.snapshot_id = f.snapshot_id
                  WHERE f.ask_id = a.id AND r.result_type = 'gathering'::text))) AS attending_at,
    ( SELECT min(q.created_at) AS min
           FROM req q
          WHERE q.ask_id = a.id) AS business_requested_at,
    ( SELECT count(*) AS count
           FROM req q
          WHERE q.ask_id = a.id) AS requests,
    LEAST(( SELECT min(bo.responded_at) AS min
           FROM req q
             JOIN business_request_offers bo ON bo.request_id = q.request_id
          WHERE q.ask_id = a.id AND bo.responded_at IS NOT NULL AND bo.status <> 'declined'::text), ( SELECT min(e.created_at) AS min
           FROM req q
             JOIN business_request_offers bo ON bo.request_id = q.request_id
             JOIN domain_events e ON e.object_kind = 'business_request_offer'::text AND e.object_id = bo.id AND e.type = 'BUSINESS_OFFER_SENT'::text
          WHERE q.ask_id = a.id)) AS offer_received_at,
    LEAST(( SELECT min(bo.accepted_at) AS min
           FROM req q
             JOIN business_request_offers bo ON bo.request_id = q.request_id
          WHERE q.ask_id = a.id), ( SELECT min(e.created_at) AS min
           FROM req q
             JOIN business_request_offers bo ON bo.request_id = q.request_id
             JOIN domain_events e ON e.object_kind = 'business_request_offer'::text AND e.object_id = bo.id AND e.type = 'BUSINESS_OFFER_ACCEPTED'::text
          WHERE q.ask_id = a.id)) AS offer_accepted_at,
    LEAST(( SELECT min(bo.visit_confirmed_at) AS min
           FROM req q
             JOIN business_request_offers bo ON bo.request_id = q.request_id
          WHERE q.ask_id = a.id AND bo.visit_confirmed_at IS NOT NULL), ( SELECT min(e.created_at) AS min
           FROM req q
             JOIN business_request_offers bo ON bo.request_id = q.request_id
             JOIN domain_events e ON e.object_kind = 'business_request_offer'::text AND e.object_id = bo.id AND e.type = 'OFFER_REDEEMED'::text
          WHERE q.ask_id = a.id)) AS redeemed_at,
    ( SELECT j.journey_outcome
           FROM req q
             JOIN request_journey j ON j.request_id = q.request_id
          WHERE q.ask_id = a.id
          ORDER BY (array_position(ARRAY['completed'::text, 'no_show'::text, 'booked'::text, 'reservation_cancelled'::text, 'offers_waiting'::text, 'expired_with_offers'::text, 'awaiting_business'::text, 'all_declined'::text, 'expired_no_offer'::text, 'request_cancelled'::text, 'merged'::text, 'not_routed'::text], j.journey_outcome)), q.created_at
         LIMIT 1) AS request_outcome,
    (EXISTS ( SELECT 1
           FROM gathering_interested gi
          WHERE gi.user_id = a.user_id AND gi.created_at >= a.created_at AND (gi.gathering_id::text IN ( SELECT r.result_id
                   FROM fam f
                     JOIN typed_ask_results r ON r.snapshot_id = f.snapshot_id
                  WHERE f.ask_id = a.id AND r.result_type = 'gathering'::text)))) AS interested_now,
    ( SELECT min(g.created_at) AS min
           FROM gathering_interested_joins j
             JOIN gathering_interest g ON g.gathering_id = j.gathering_id AND g.user_id = j.user_id AND g.status = 'approved'::text
          WHERE j.user_id = a.user_id AND j.interested_at >= a.created_at AND (j.gathering_id::text IN ( SELECT r.result_id
                   FROM fam f
                     JOIN typed_ask_results r ON r.snapshot_id = f.snapshot_id
                  WHERE f.ask_id = a.id AND r.result_type = 'gathering'::text))) AS interested_then_attending_at
   FROM asks a
     LEFT JOIN intent_submissions sub ON sub.id = a.submission_id;
