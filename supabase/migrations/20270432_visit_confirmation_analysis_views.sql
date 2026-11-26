-- Visit confirmation, part 3 (STAGED on post-tier1/visit-confirmation, after 20270431; never production without its own
-- approval): the service-role analysis views (request_journey, routing_candidate_outcomes, intent_funnel) count a visit as
-- completed / redeemed only when the BUSINESS confirmed it (visit_confirmed_at). No client grant changes.

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

