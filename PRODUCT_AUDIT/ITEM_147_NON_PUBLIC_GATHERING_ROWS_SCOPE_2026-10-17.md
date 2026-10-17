# Item 147: Non-public gathering details readable by anyone (scope, 2026-10-17) - HIGH PRIORITY SECURITY

Owner decision (2026-10-17, item 146's D3): a separate, high-priority security item. Item 146 fixed only the coordinates and
must not be mistaken for complete gathering privacy. (Unrelated to the older "Item 147" entries of September in CLAUDE_HISTORY.md.)

**Status: BUILT, LIVE, NOT DEVICE-VERIFIED (2026-10-17)** - see "Build + verification" at the end.

## The problem (confirmed live)

- `gatherings` has one SELECT policy, `Anyone can view gatherings`, `qual = true`, role public. With the column grant
  (item 146: every column except precise_lat/lng), ANY caller, signed out included, can read every row of any visibility:
  invite-only, friends-only and community gatherings' title, description, host_id, scheduled_at, area (~1 km grid),
  wide_area, capacity, community_id, cover_photo_path, timeline_steps, women_only, etc.
- Evidence: 2026-10-17 probe (rolled back): as `anon`, an invite-only gathering returned its title (and, before item 146,
  its exact point). Journey `preciseLocation` asserts this on purpose
  (`anon_invite_only.safe` = the invite-only title), so that test fails and gets updated when this item lands.
- Also exposed through the same rows: who hosts what and when (host_id + scheduled_at) for private plans. The pin
  (`get_gathering_distances`, ~390 m) is returned for any id a caller knows. Once rows are private, ids are no longer
  enumerable, but the RPC itself has no visibility check (item 146 deliberately left it for this item).

## Required outcome (proposed for owner approval)

1. A gathering row is readable only by someone who may see it: the existing rule `_viewer_can_see_gathering` (host, anyone
   with a join row, an invitee, else not blocked with the host + women-only rule + visibility everyone/link-only, friends
   of the host, community members; invite-only = invitees only), decided in the database.
2. Signed-out visitors see only what a public invite link already shows, through `get_public_gathering_invite_preview`
   (existing RPC). No direct anon row reads of non-public gatherings.
3. Every legitimate path keeps working: Discover/Home lists, detail, Plans, host tools, attendees, invitees, communities,
   business partners on gatherings they host or were routed (check each), journeys, pushes (server side).
4. Every RPC that returns gathering fields by id (`get_gathering_distances`, others to be listed) applies the same rule.

## Audit to do before changing anything

- Every client read of `gatherings` (32 `from('gatherings')` calls + embeds from ~10 tables) and what each viewer expects.
- Every SECURITY INVOKER function and RLS policy on OTHER tables that reads `gatherings` (they would start seeing fewer rows).
- Every SECURITY DEFINER RPC returning gathering fields by id, with its current visibility check.
- Cost: `_viewer_can_see_gathering` per row on list reads (index/perf check on the Discover query).
- Blocks: hidden both ways (convention: `viewer_blocked_either_way` inside the read).

## Verification plan

- A journey under the real roles (like `preciseLocation`): anon, stranger, friend of host, community member, invitee,
  pending, waitlisted, approved, host, blocked person: per visibility (everyone, friends, community, invite_only):
  row readable or not, list/embeds/filters, the RPCs.
- Full Jest + journeys; from-scratch replay incl. the migration; grant/policy parity with prod.

## Not in scope

Coordinates (item 146, done). Stories/sightings location (item 148, scoped separately).

## Build + verification (2026-10-17, owner approved the build the same day)

**Status: BUILT, LIVE, NOT DEVICE-VERIFIED.** Migration `supabase/migrations/20270322_non_public_gathering_rows.sql`, applied
to production 2026-10-17. Device checks: `ITEM_147_NON_PUBLIC_GATHERING_ROWS_DEVICE_CHECKLIST_2026-10-17.md`.

What the audit found beyond the scope above (all fixed by the same migration):
- Joining granted visibility: any join row makes a gathering visible, and `join_gathering` checked invite-only, women-only and
  blocks but not friends/community visibility, so a stranger could join (and from then on read) a friends/community gathering
  by id. A direct `gathering_interest` insert did the same. `set_gathering_interested` and `send_social_invite` also accepted
  gatherings the caller could not see (a pending invite grants visibility to the invitee).
- The women-only INSERT policy on `gathering_interest` reads `gatherings` as the caller: with private rows it would have
  silently passed for a man. The new trigger enforces the rule instead.
- `gathering_questions` was readable by anyone, anon included (`true`); the gathering-photos bucket's read policy checked the
  bucket only (any caller could sign any cover photo's URL).
- By-id RPCs with no visibility check: `get_gathering_distances` (pin), `get_gathering_approved_counts`,
  `get_gathering_attendee_breakdown`, `get_gathering_first_timer_count`; id lists `get_bounded_nearby_gathering_ids`,
  `get_trending_gathering_ids` returned non-public discoverable ids.
- A business partner on someone else's gathering (`hosting_partner_id`, set when the owner approves a partnership request)
  and a business with a pending request needed an explicit rule, or its dashboard would lose those gatherings.

The rule (`_gathering_row_visible`, takes the row's columns so the host's `insert/update ... returning` works): host; any join
row; pending/accepted invite; the partner business (or one with a pending/approved request); else not blocked either way +
women-only + everyone (incl. link-only) / friends of host / community members; invite-only = invitees only; signed out = no.
`_viewer_can_see_gathering` reads the row and calls it (stays not client-callable).

Verification:
- Journey `gatheringRowPrivacy` 28/28: 12 actors under real roles x 8 gatherings (public, link-only, friends, community,
  invite-only, women-only, partnered, partnership-asked) x every read path (rows, distances, counts, breakdown, first timers,
  bounded, trending, Q&A, cover photo objects); refused writes return 'Gathering not found'; legitimate writes still work.
  Mutation check: on production before the migration, 18 of its 28 tests failed.
- Journeys `preciseLocation` (anon/stranger expectations updated: no row) and `friendsPlanning` (the database no longer returns
  a friend's invite-only plan) updated. All journeys 473/473 with the migration as prelude, then on production after apply.
- Jest: all suites pass (6130 tests); guard `src/utils/gatheringRowPrivacyGuard.test.js` (9) + the visibility-helper guard in
  `businessPrivacyBoundary.test.js` updated (the rule now lives in `_gathering_row_visible`).
- From-scratch replay 446/446, journeys 473/473 on it, both concurrency scripts pass; grants/policies/triggers parity
  replay = prod 12451/12451 (function execute + column grants for anon/authenticated, policies on the touched tables, triggers).
- Real API, signed out, after apply: `GET /rest/v1/gatherings` = `[]` (not measured through the API before; the policy was `true`, prod holds 25 rows), `gathering_questions` = `[]`, the invite
  link RPC still returns its preview.
- Cost: the rule is ~0.2 ms per row (EXPLAIN ANALYZE on 25 rows: 4.5 ms); a 500-row Discover candidate read ~ 90 ms worst case.

Left as is, reported: `get_public_gathering_invite_preview` gives anyone holding an id the title/time/host/attendee count
(that is the shared link's preview, by design); `get_host_stats` / `get_host_reputation` count across all of a host's
gatherings (aggregates, no titles); `gathering_feedback` stays readable by any signed-in user (host reputation) and a host's
"great because" chips on another viewer's screen now count only gatherings that viewer may see (the `!inner` embed); pushes
are built server-side and unchanged. Not done: a signed-in real-API test (separate step), device checks.
