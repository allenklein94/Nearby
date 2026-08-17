-- Found while running the live-verify suite as part of closing the C2/C3 group-plan
-- concurrency gap (see CLAUDE.md): 20260817_group_plan_funnel_linkage.sql added
-- submission_id_param to create_business_request() via `create or replace function
-- create_business_request(..., submission_id_param uuid default null)` -- but since
-- Postgres treats a function with a different argument list as a distinct overload
-- (CREATE OR REPLACE only replaces a function with the *same* signature), this left
-- the original 11-arg version still live in production alongside the new 12-arg one,
-- rather than actually replacing it.
--
-- The 12-arg version is a strict superset of the 11-arg one (identical first 11
-- params, submission_id_param defaults to null) -- so the 11-arg overload is now
-- genuinely dead weight, not a real second code path with different behavior. Worse,
-- it's an active ambiguity hazard: any call supplying exactly 11 args (positional, or
-- named without submission_id_param) matches *both* overloads -- Postgres can't choose
-- and raises "function create_business_request(...) is not unique". Confirmed this is
-- a real, live bug, not theoretical: scripts/live-verify/business-request-duplicate-
-- submission.js's own raw-SQL positional 11-arg call started failing with exactly this
-- error the first time it was re-run after the 12-arg version landed.
--
-- The real app itself was never actually hit by this -- services/businessFulfillment.js's
-- submitBusinessRequest() always passes submission_id_param (even as null) as a named
-- RPC argument, so PostgREST always supplies all 12 named args, which only the 12-arg
-- overload can match. But an orphaned, ambiguity-prone duplicate overload is still real
-- schema debt worth closing outright, matching this codebase's own established
-- precedent for exactly this situation (e.g. the Aug 11 2026 `update_business_profile`
-- fix, which explicitly dropped its old 7-arg overload rather than leaving it orphaned).
drop function if exists public.create_business_request(
  text, double precision, double precision, text, integer, integer, integer,
  date, time without time zone, time without time zone, double precision
);
