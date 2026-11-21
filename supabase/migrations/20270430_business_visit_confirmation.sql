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
--   * Business-facing figures switched from status 'completed' to visit_confirmed_at here (value, performance, reputation,
--     funnel, category outcomes, reliability rankings, market validation, the Bookings list, offer evidence + admin history).
--     The routing track record moves in 20270431 and the analysis views in 20270432 (deploy all three, in order).
--     Not touched (checked): paid-placement refunds (their own status, no offer completion), Stripe/edge functions (no
--     completion dependency), _learn_from_redemption (the customer's own learning, fires on status as before).
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

-- get_business_opportunities: the business's own rows carry visit_confirmed_at (never customer_done_at), so Bookings
-- can offer Confirm visit / Didn't show up and the pipeline counts only confirmed visits.
CREATE OR REPLACE FUNCTION public.get_business_opportunities(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      bro.offer_description, bro.proposed_time, bro.proposed_time_alt, bro.proposed_party_size_alt, bro.proposed_party_size, bro.created_at, bro.expires_at,
      bro.offer_title, bro.included_items, bro.discount_pct, bro.valid_until, bro.available_from, bro.available_until,
      bro.auto_reply, bro.revision, bro.revised_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.visit_confirmed_at, bro.status,
      bro.availability_id, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id, bro.is_directed,
      jsonb_build_object(
        'category', br.category,
        -- Item 119b: a booking made for fewer people shows the headcount booked (summary too), never the 6 asked for.
        'party_size', coalesce(bro.proposed_party_size, br.party_size),
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'summary', case when bro.proposed_party_size is not null and br.party_size is not null
          then replace(public.business_safe_request_summary(br.id), 'party of ' || br.party_size, 'party of ' || bro.proposed_party_size)
          else public.business_safe_request_summary(br.id) end,
        'is_match_request', br.match_id is not null,
        'attributes', br.attributes,
        'dietary', case when cardinality(br.dietary) > 0 then to_jsonb(br.dietary) else null end,
        'cuisine', br.cuisine,
        'requested_items', case when cardinality(br.requested_items) > 0 then to_jsonb(br.requested_items) else null end,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'note', case when bro.is_directed then br.note_for_business else null end,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'title', case when bro.is_directed and public._title_safe_for_business(g.title) then g.title else null end,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level
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

-- Offer evidence (20270416) + the admin's Offer history: "Redeemed" only from the business's confirmation. Business side
-- only, as 20270416 requires: the customer's own "Mark as done" (customer_done_at) is customer data and is never kept or
-- shown here; a completion the business did not confirm reads "not confirmed by the business".
alter table private.offer_evidence
  add column if not exists visit_confirmed_at timestamptz;

create or replace function private.keep_offer_evidence(o public.business_request_offers)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reasons record;
  v_name text;
  v_tier text;
  v_screened timestamptz;
  v_state text;
begin
  if o.status = 'pending' then
    return; -- a routed request the business never answered: nothing the business sent
  end if;
  begin
    if exists (select 1 from private.offer_evidence e where e.offer_id = o.id) then
      return;
    end if;
    select * into v_reasons from private.offer_evidence_reasons(o.id, o.partner_id);
    if cardinality(v_reasons.report_ids) + cardinality(v_reasons.case_ids) + cardinality(v_reasons.hold_ids) = 0 then
      return;
    end if;
    select bp.name into v_name from brand_partners bp where bp.id = o.partner_id;
    select s.risk_tier, s.created_at into v_tier, v_screened
      from business_content_screening_results s
     where s.partner_id = o.partner_id and s.target_type = 'offer_response' and s.target_id = o.request_id
     order by s.created_at desc limit 1;
    insert into private.offer_evidence (offer_id, partner_id, partner_name, request_id, offer_type, offer_title, offer_description,
        included_items, redemption_instructions, offer_price, price_is_per_person, discount_pct, proposed_time, proposed_time_alt,
        auto_reply, status, created_at, responded_at, viewed_at, accepted_at, completed_at, cancelled_at, visit_confirmed_at,
        screening_risk_tier, screened_at, kept_for_reports, kept_for_cases, kept_for_holds)
      values (o.id, o.partner_id, v_name, o.request_id, o.offer_type, o.offer_title, o.offer_description,
        o.included_items, o.redemption_instructions, o.offer_price, o.price_is_per_person, o.discount_pct,
        o.proposed_time, o.proposed_time_alt, o.auto_reply, o.status, o.created_at, o.responded_at, o.viewed_at,
        o.accepted_at, o.completed_at, o.cancelled_at, o.visit_confirmed_at, v_tier, v_screened,
        v_reasons.report_ids, v_reasons.case_ids, v_reasons.hold_ids)
      on conflict (offer_id) do nothing;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    begin
      insert into private.offer_evidence_failures (offer_id, sqlstate) values (o.id, v_state);
    exception when others then null;
    end;
  end;
end;
$function$;

-- New output columns (appended): drop + recreate, grants as before.
drop function if exists public.admin_business_offer_history(uuid, integer);
create or replace function public.admin_business_offer_history(partner_id_param uuid, limit_param integer default 50)
returns table (offer_id uuid, source text, created_at timestamptz, offer_title text, offer_description text, status text,
               screening text, screened_at timestamptz, viewed_at timestamptz, accepted_at timestamptz, completed_at timestamptz,
               cancelled_at timestamptz, reported boolean, visit_confirmed_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
  with live as (
    select o.id, 'live'::text as src, o.created_at, o.offer_title, o.offer_description, o.status,
           case when o.auto_reply is not null then 'automatic' else s.risk_tier end as scr, s.created_at as scr_at,
           o.viewed_at, o.accepted_at, o.completed_at, o.cancelled_at, o.visit_confirmed_at
      from business_request_offers o
      left join lateral (select r.risk_tier, r.created_at from business_content_screening_results r
                          where r.partner_id = o.partner_id and r.target_type = 'offer_response' and r.target_id = o.request_id
                          order by r.created_at desc limit 1) s on true
     where o.partner_id = partner_id_param and o.status <> 'pending'
  ), kept as (
    select e.offer_id, 'kept'::text, e.created_at, e.offer_title, e.offer_description, e.status,
           case when e.auto_reply is not null then 'automatic' else e.screening_risk_tier end, e.screened_at,
           e.viewed_at, e.accepted_at, e.completed_at, e.cancelled_at, e.visit_confirmed_at
      from private.offer_evidence e
     where e.partner_id = partner_id_param
  )
  select a.id, a.src, a.created_at, a.offer_title, a.offer_description, a.status, a.scr, a.scr_at, a.viewed_at, a.accepted_at,
         a.completed_at, a.cancelled_at,
         exists (select 1 from reports r where r.content_type = 'business_offer' and r.content_id = a.id),
         a.visit_confirmed_at
    from (select * from live union all select * from kept) a
   order by a.created_at desc nulls last
   limit greatest(1, least(coalesce(limit_param, 50), 200));
end;
$function$;

revoke all on function public.admin_business_offer_history(uuid, integer) from public, anon;
grant execute on function public.admin_business_offer_history(uuid, integer) to authenticated;
