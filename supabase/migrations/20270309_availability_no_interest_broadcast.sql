-- Item 114 (owner, LOCKED 2026-10-15), implemented 2026-10-15: business availability reaches ONLY people with a matching OPEN
-- request. A business posting availability must never, on its own, notify anyone because of their interests, distance or time
-- preferences. The trigger below did exactly that ("🌟 This matches you" to nearby people whose declared interests matched,
-- opt-out, since 20261004_recommended_for_you_push.sql); it is removed with its function so nothing can re-attach it.
-- Unchanged: post_business_availability's open-request loop (each matching open request gets the business's reply and the
-- request's reply push, type business_offer_received, collapse_key 'offers:<request id>', via _send_push's outbox + dedupe,
-- item 62). Gathering recommendation pushes (recommendation_push_log, things-to-do caps) are untouched.
-- The profiles.notify_nearby_opportunities_* columns are left in place (no data dropped); nothing reads them any more.
-- Guards: src/journeys/availabilityNoBroadcast.journey.js, src/constants/availabilityNoBroadcastGuard.test.js.

drop trigger if exists on_business_availability_created_notify_nearby_opportunities on public.business_availability;
drop function if exists public.notify_matching_business_availability();
