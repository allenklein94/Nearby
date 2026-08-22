-- Fixes a real, confirmed data-integrity bug: CreateGatheringScreen's
-- "Ask Local Businesses" checkbox fired create_business_request_for_gathering()
-- synchronously right after createGathering() succeeded -- at that exact
-- moment zero real attendees exist yet, so the RPC's own
-- `select count(*) ... where status = 'approved'` always computes 0, and
-- party_size always lands on 1 (0 approved + the host). Worse, the RPC's
-- own duplicate guard (one open business_requests row per gathering_id)
-- then permanently locks that gathering to the fabricated size-1 request
-- -- calling it again later, once real attendees exist, just returns the
-- same stale row unchanged (`duplicate: true`), never correcting the size.
--
-- Fixed per the locked decision: defer the request, not the host's
-- consent. This migration only stores the checkbox's real intent on the
-- gathering itself -- the actual business_requests row is created later,
-- once real gathering state exists to make an honest ask from, via the
-- exact same create_business_request_for_gathering() RPC (byte-for-byte
-- unchanged, no design change needed there -- it already computes
-- party_size correctly from real gathering_interest rows at whatever
-- moment it's actually called).

alter table public.gatherings
  add column if not exists ask_local_businesses boolean not null default false;
