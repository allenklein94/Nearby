-- Closes the "no spatial/composite index on (category, lat, lng)" risk
-- flagged in V2_ACCEPTANCE_REPORT_2026-08-15.md §9 and carried forward as a
-- still-open item in PRODUCT_AUDIT/CONSOLIDATED_AUDIT_2026-08-15.md.
--
-- Both group-intent and aggregated-demand AFTER INSERT triggers
-- (20260815_group_intent_and_demand_notifications.sql) run a per-row
-- haversine compute filtered by (status = 'open', category = ...,
-- expires_at > now()) on every single business_requests insert. The
-- existing business_requests_open_expires_idx only covers (status,
-- expires_at) -- category isn't part of it, so a query filtered by category
-- still has to scan every open row regardless of category before the
-- haversine math runs on each.
--
-- A real spatial index (PostGIS geography + GiST) is not attempted here --
-- consistent with this codebase's existing, deliberate choice everywhere
-- else that does proximity filtering (get_bounded_nearby_gathering_ids's own
-- plain bounding-box-then-haversine approach, no new extension). This adds
-- the plain composite/partial B-tree indexes that actually narrow the row
-- set before the haversine math runs, matching the existing
-- business_requests_open_expires_idx's own partial-index shape exactly.

create index if not exists business_requests_open_category_idx
  on public.business_requests(category, expires_at)
  where status = 'open';

-- The aggregated-demand trigger's own outer loop scans every active
-- brand_partners row with real coordinates on every single
-- business_requests insert, before ever computing haversine against it.
-- Narrows that scan the same way.
create index if not exists brand_partners_active_coords_idx
  on public.brand_partners(id)
  where active = true and latitude is not null and longitude is not null;
