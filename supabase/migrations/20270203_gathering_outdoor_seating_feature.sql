-- Owner decision (2026-09-25, item 55 follow-up): keep the party-type/plan-kind privacy invariant from 20270202
-- fully intact (a business must never learn Friends/Date/Family or any social context). Outdoor seating is a
-- different kind of thing: a concrete, host-declared VENUE preference, not social context, so it is added to the
-- SAME closed `gatherings.features` list the accessibility/family keys already use (20270198) -- no second
-- attribute system. It already flows end to end with no other change: `_gathering_request_attributes` (20270201)
-- snapshots whatever is in `gatherings.features` into the request's `attributes` column, which the existing
-- attribute-overlap scoring (businessOpportunityScoring.js) and "Customer is looking for" chips already read
-- generically via the one shared BUSINESS_ATTRIBUTE_OPTIONS vocabulary (outdoor_seating already a member of it).
alter table public.gatherings drop constraint if exists gatherings_features_check;
alter table public.gatherings add constraint gatherings_features_check check (
  features <@ array['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'quiet', 'kid_friendly', 'stroller_friendly', 'family_seating', 'outdoor_seating']::text[]
);
