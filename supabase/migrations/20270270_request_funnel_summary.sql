-- Owner item 153 (2026-10-03): does the business side of the loop respond? request_funnel_summary =
--   Requests -> Reached a business -> Offer received -> Offer accepted -> Redeemed
-- for EVERY business request (all sources), next to (not replacing) the typed-ask intent funnel, which is unchanged.
--
-- Read only from request_journey (20270241). Three columns are appended to it, all derived from existing records
-- (no new tracking, no change to routing, offers, redemption or any screen):
--   offers_made     = offer rows where a business actually made an offer at some point: accepted, or answered with
--                     anything but a decline (every auto-offer writes responded_at; expire/cancel sweeps only move
--                     pending/offered rows and never write responded_at, so an answered-then-expired or withdrawn offer
--                     still counts and a decline never does), or a business_lifecycle_events 'offered' row (20270267).
--   first_offer_at  = the earliest known moment of the first offer made (least of responded_at and the first 'offered'
--                     lifecycle event; each is at or after the real moment, so the earlier is the better estimate).
--   request_week    = the calendar week (Monday, UTC) the request was CREATED. A request stays in its creation cohort
--                     forever: an offer or redemption in a later week never moves it. Stage timestamps stay on
--                     request_journey (requested_at, first_offer_at, accepted_at, completed_at) for timing analysis.
--
-- Stage definitions (each nested in the one before, so a drop-off is never negative):
--   requests       every business request
--   reached        the request was put in front of at least one business by the real routing (fan-out, a request
--                  addressed to one business, or an auto-offer matcher): it has an offer row, which is exactly what makes
--                  it appear on that business's Opportunities. Never inferred from a category or an attached business.
--   offer_received offers_made > 0
--   accepted       the customer accepted a business's offer (accepted_at on the booked offer)
--   redeemed       the business confirmed the visit through the code flow (journey_outcome 'completed'). Visits, not
--                  dollars: Nearby does not know what the customer spent.
-- Rates are conditional (each over the stage before); drop-offs are counts. Every drop-off is split into break points
-- that add up to it exactly:
--   requests -> reached:        no_business_reached
--   reached -> offer:           all_declined (every business that got it declined), expired_no_offer,
--                               cancelled_no_offer, merged_no_offer, still_open_no_offer (businesses not answered yet)
--   offer -> accepted:          expired_with_offers, cancelled_with_offers, merged_with_offers, still_open_with_offers
--   accepted -> redeemed:       no_show, reservation_cancelled, booked_not_redeemed (visit not confirmed yet)
-- Breakdowns: overall (all history), request source, typed ask (only requests carrying the ask's own id, as in
-- request_journey; nothing attached by time or category), area, category, creation week. No rolling windows.
-- Internal only: no anon/authenticated/business access (service role / Management API), like request_journey.
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
    win.completed_at,
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
            WHEN win.status = 'completed'::text THEN 'completed'::text
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
    date_trunc('week'::text, r.created_at AT TIME ZONE 'UTC'::text)::date AS request_week
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

revoke all on public.request_journey from public, anon, authenticated;

create or replace view public.request_funnel_summary as
with j as (
  select *,
    offers_total > 0 as is_reached,
    offers_made > 0 as is_offered,
    accepted_at is not null as is_accepted,
    journey_outcome = 'completed' as is_redeemed,
    (offers_total > 0 and coalesce((offers_by_status ->> 'declined')::bigint, 0) = offers_total) as is_all_declined,
    coalesce(area_key, 'unknown') as area_v,
    coalesce(category, 'unknown') as category_v,
    case when ask_snapshot_id is not null then 'yes' else 'no' end as typed_ask_v
  from public.request_journey
),
g as (
  select
    case when grouping(request_source) = 0 then 'source' when grouping(typed_ask_v) = 0 then 'typed_ask'
         when grouping(area_v) = 0 then 'area' when grouping(category_v) = 0 then 'category'
         when grouping(request_week) = 0 then 'week' else 'overall' end as dimension,
    coalesce(case when grouping(request_source) = 0 then request_source end, case when grouping(typed_ask_v) = 0 then typed_ask_v end,
             case when grouping(area_v) = 0 then area_v end, case when grouping(category_v) = 0 then category_v end,
             case when grouping(request_week) = 0 then request_week::text end, 'all') as value,
    count(*) as requests,
    count(*) filter (where is_reached) as reached,
    count(*) filter (where is_reached and is_offered) as offer_received,
    count(*) filter (where is_reached and is_offered and is_accepted) as accepted,
    count(*) filter (where is_reached and is_offered and is_accepted and is_redeemed) as redeemed,
    -- requests -> reached
    count(*) filter (where not is_reached) as no_business_reached,
    -- reached -> offer
    count(*) filter (where is_reached and not is_offered and is_all_declined) as all_declined,
    count(*) filter (where is_reached and not is_offered and not is_all_declined and request_status = 'expired') as expired_no_offer,
    count(*) filter (where is_reached and not is_offered and not is_all_declined and request_status = 'cancelled') as cancelled_no_offer,
    count(*) filter (where is_reached and not is_offered and not is_all_declined and request_status = 'merged') as merged_no_offer,
    count(*) filter (where is_reached and not is_offered and not is_all_declined and request_status not in ('expired', 'cancelled', 'merged')) as still_open_no_offer,
    -- offer -> accepted
    count(*) filter (where is_reached and is_offered and not is_accepted and request_status = 'expired') as expired_with_offers,
    count(*) filter (where is_reached and is_offered and not is_accepted and request_status = 'cancelled') as cancelled_with_offers,
    count(*) filter (where is_reached and is_offered and not is_accepted and request_status = 'merged') as merged_with_offers,
    count(*) filter (where is_reached and is_offered and not is_accepted and request_status not in ('expired', 'cancelled', 'merged')) as still_open_with_offers,
    -- accepted -> redeemed
    count(*) filter (where is_reached and is_offered and is_accepted and not is_redeemed and journey_outcome = 'no_show') as no_show,
    count(*) filter (where is_reached and is_offered and is_accepted and not is_redeemed and journey_outcome = 'reservation_cancelled') as reservation_cancelled,
    count(*) filter (where is_reached and is_offered and is_accepted and not is_redeemed and journey_outcome not in ('no_show', 'reservation_cancelled')) as booked_not_redeemed
  from j
  group by grouping sets ((), (request_source), (typed_ask_v), (area_v), (category_v), (request_week))
)
select dimension, value, requests, reached, offer_received, accepted, redeemed,
  round(reached::numeric / nullif(requests, 0), 4) as reached_rate,
  round(offer_received::numeric / nullif(reached, 0), 4) as offer_received_rate,
  round(accepted::numeric / nullif(offer_received, 0), 4) as accepted_rate,
  round(redeemed::numeric / nullif(accepted, 0), 4) as redeemed_rate,
  requests - reached as drop_off_before_reached,
  reached - offer_received as drop_off_before_offer_received,
  offer_received - accepted as drop_off_before_accepted,
  accepted - redeemed as drop_off_before_redeemed,
  no_business_reached,
  all_declined, expired_no_offer, cancelled_no_offer, merged_no_offer, still_open_no_offer,
  expired_with_offers, cancelled_with_offers, merged_with_offers, still_open_with_offers,
  no_show, reservation_cancelled, booked_not_redeemed
from g;

revoke all on public.request_funnel_summary from public, anon, authenticated;
