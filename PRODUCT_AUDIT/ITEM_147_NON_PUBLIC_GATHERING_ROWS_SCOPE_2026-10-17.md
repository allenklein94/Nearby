# Item 147: Non-public gathering details readable by anyone (scope, 2026-10-17) - HIGH PRIORITY SECURITY

Owner decision (2026-10-17, item 146's D3): a separate, high-priority security item. Item 146 fixed only the coordinates and
must not be mistaken for complete gathering privacy. (Unrelated to the older "Item 147" entries of September in CLAUDE_HISTORY.md.)

**Status: SCOPED, NOT STARTED, OPEN.** Needs its own build approval.

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

Coordinates (item 146, done). Stories/sightings pins (reported separately, see CLAUDE.md known residuals).
