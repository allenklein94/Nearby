# Design: opt-in interest sharing on business requests (2026-09-18) -- NOT BUILT, awaiting go

## Goal
A user who says "live music + fitness + outdoors" can let a business see that on ONE request so the offer
fits, without Nearby ever handing a third party their profile.

## Principles (from CLAUDE.md conventions)
- Explicit consent, per request. Default OFF. Never inferred, never silent ("AI suggests, never silently commits").
- Snapshot, not a live link: the tags are copied onto the request at send time. Later profile edits don't
  change what a business already saw; the business never gets a profile id, name, photo or a way to look one up.
- Tags only, canonical vocabulary, capped (8). No cuisine/venue tastes, no basics, no free text.
- Each actor reports its own side: the requester states what to share; the business only reads it.
- No stranger/privacy regression: businesses already see requests without the requester's identity
  (`requester_display_name` null pre-acceptance); this adds anonymous taste tags, nothing that identifies.

## Where it appears
- Consumer: AskBusinessScreen (solo/for-me requests) review step gets one toggle row:
  "Share my interests with businesses" + the exact tags that will be sent, each removable, + "Helps them tailor
  offers. Businesses never see your name or profile." Off by default. Choice is per-request (not remembered)
  -- avoids a forgotten global switch quietly leaking on later requests.
- Not offered on: dating-sourced requests (`create_business_request_for_match`), surprise-mode requests,
  or requests made for someone else (Plan for Someone) -- the interests would be the requester's, not the
  guest's, and could mislead or leak context. Gathering/community requests: not in v1 (group, not personal).
- Business: BusinessRequestDetail + dashboard opportunity card show "They're into: Live Music · Outdoors"
  only when shared. Absent = nothing rendered (honest absence, no placeholder).
- Matching: `businessOpportunityScoring` may treat overlap between shared tags and the business's own
  category/subcategory/categories as one bounded, disclosed boost with reason text "Matches what they're into".
  Never a penalty for absence (most requests won't share).

## Data + server
1. Migration `business_requests.shared_interests text[]` (null = not shared). CHECK: cardinality <= 8.
2. `create_business_request` gains trailing `shared_interests_param text[] default null`.
   CONVENTION TRAP: new trailing param = second overload. The migration must `drop function` the old exact
   signature first, and verify one row in `pg_get_function_identity_arguments` afterwards.
   Server validates tags against the canonical vocabulary (an allow-list in SQL or filtered against
   the caller's own `profiles.interests` so a client can only share what they actually declared -- preferred:
   `shared_interests` must be a subset of the caller's profile interests) and ignores it for match/surprise/
   for-someone-else requests.
3. `get_business_opportunities` RETURNS TABLE gains `shared_interests` -> column-list change also creates an
   overload; drop old signature in the same migration, re-`revoke ... from public, anon`.
4. RLS unchanged: businesses do not read `business_requests` directly (they go through the RPC), and the
   requester's own SELECT policy already covers the row.
5. One migration file per change, filename sorted after the migrations it depends on.

## Client
- `interestGraph.js`: `shareableInterestsFor(profileInterests)` (canonical, capped 8) + test.
- `businessFulfillment.createBusinessRequest`: optional `sharedInterests` -> RPC param.
- AskBusinessScreen toggle + chips; BusinessRequestDetail/Dashboard display; scoring boost + test.

## Verification plan
- Unit: helper, scoring boost/no-penalty, display-only-when-present.
- Live (rolled-back transaction, disposable users, no push): RPC stores subset-of-profile only, rejects/ignores
  non-declared tags, ignores for match/surprise, `get_business_opportunities` returns tags to the owning business
  and never a requester id/name; single overload of each function after migration.
- Then: regenerate business web export (business screens change) and commit.

## Open questions for the owner
1. Show the business the tags on the request itself, or only after the business sends an offer?
   (Recommended: on the request, since the point is tailoring the offer.)
2. Allow sharing on gathering/community requests later (group request; whose interests?) -- recommended: no.
3. OK with the scoring boost, or display-only for v1? (Recommended: display + small boost.)
