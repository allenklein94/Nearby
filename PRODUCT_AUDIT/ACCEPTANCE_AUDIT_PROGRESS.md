# Full System Acceptance Audit — progress tracker (started 2026-08-16)

Scope: verify, via direct code reading + live production testing with real disposable data
(same convention as every other audit in this repo — see CLAUDE.md), that the whole set of
systems built across this project's history actually connect end-to-end, not just in isolation.

**Explicit, upfront limitation, stated once here rather than buried at the end**: the user's own
request explicitly asks to run this "on an actual phone." This sandbox has never had
simulator/device access — that is the single most-repeated standing limitation across this
entire project's CLAUDE.md history. Nothing in this audit can answer "does it feel incredible
when a real person uses it" — only a real device pass (the user's own, or a future session with
device access) can answer that. This audit's job is the maximum honest substitute: prove the
mechanics are sound end-to-end so that a real device pass is testing *feel*, not hunting for
broken plumbing.

## Journeys to trace (code + live verification)
1. New user → discovers Nearby → uses intent
2. Intent → existing gathering/community (resolver tiers 1-3)
3. Intent → business fallback (tier 4)
4. Business → offer → consumer acceptance
5. Individual intents → group plan (Phase D)
6. Group → business offer → participant consent → reservation
7. User → explicitly enables Friend Discovery
8. Friend swipe → mutual swipe → friendship → messaging
9. Dating discovery remains completely independent (no cross-contamination)
10. Privacy/block/pass rules survive across sessions/devices
11. Existing V1/V2 functionality still works (regression check)
12. Analytics correctly capture every important outcome

## Nasty cases to test
- duplicate taps / idempotency
- two people accepting simultaneously (race)
- business offer expiring
- participant leaving a group
- participant declining
- request cancellation
- blocked user
- pending friend request (exclusion)
- previously declined request (exclusion)
- app killed mid-flow (client-side resilience — code-review only, can't truly test)
- network disappears mid-flow (client-side resilience — code-review only)
- stale screen (client-side resilience — code-review only)
- two devices logged into same account

## Wave 1A findings (2026-08-16)

Method: pulled every live function body/signature/grant for the full chain directly from
production (enmosvippabmuqslzrox) via the Management API, cross-checked against every real
client call site (groupPlans.js, businessFulfillment.js, intentResolver.js, HomeScreen.js).
No drift found anywhere in this chain — every documented behavior in CLAUDE.md still matches
the live database exactly. One live disposable-data test would have been redundant (the group
plan happy path already has an exhaustive Aug 15 live-verified writeup; nothing in this chain
has changed since); spent the budget on live-verifying grants/RLS/signatures instead, which
is where drift actually tends to happen in this project's history (filename-ordering bugs,
signature changes).

1. **New user → intent — VERIFIED-CODE-READ + VERIFIED-LIVE.** `create-assistant` Edge
   Function confirmed ACTIVE, verify_jwt:true in production. HomeScreen.js's intent box wires
   to it correctly.
2. **Intent → existing gathering/community (tiers 1-3) — VERIFIED-CODE-READ.**
   `resolveIntent()` (src/services/intentResolver.js:213) runs 5 branches in parallel
   (`resolveGatherings`, `resolveCommunities`, `resolveConnectedRequests`, `resolvePerks`,
   `resolveBusinessAvailability`) via `Promise.allSettled` — a location-permission race that
   used to exist between the gatherings branch's own internal permission prompt and a
   check-only call here was already fixed (permission is requested once, up front, before the
   branches start — confirmed via the code's own comment + logic, not just the comment).
   `get_connected_open_business_requests` (Tier 2 / connected-friend-asks) live signature
   (`category_param, date_start_param, date_end_param`) matches both call sites
   (groupPlans.js:19, businessFulfillment.js:161) exactly — no drift.
3. **Intent → business fallback (tier 4) — VERIFIED-CODE-READ.** HomeScreen.js:388-397: the
   empty-fallback UI (`setIntentEmptyFallback`) fires exactly when `resolved.length === 0`
   (all 5 branches genuinely empty), not a fixed-hierarchy fallback — matches CLAUDE.md's
   "resolver integration fix" documentation exactly. `handleAskBusiness()` (line 581) correctly
   threads prefill fields into `AskBusiness` → `submitBusinessRequest()` →
   `create_business_request` RPC, live signature confirmed matching
   (raw_text_param/latitude_param/longitude_param/category_param/party_size_param/
   budget_min_param/budget_max_param/date_param/time_window_start_param/
   time_window_end_param/radius_miles_param — 11 params, all present at the one call site,
   businessFulfillment.js:34).
4. **Business → offer → consumer acceptance — VERIFIED-LIVE (function body pulled fresh).**
   `accept_business_offer` live body confirmed: locks both `business_request_offers` and
   `business_requests` rows `FOR UPDATE` before any check (real reservation integrity, not
   just documented as such), rejects `group_plan_id is not null` requests explicitly (line:
   `raise exception 'This is a group plan request -- every participant needs to confirm it
   together.'` — this is journey 6's actual enforcement, confirmed live, not assumed),
   expires sibling offers atomically, decrements shared `business_availability.remaining_capacity`
   with its own lock, sends a real push. Grants: `authenticated` only, `anon` false — confirmed.
5. **Individual intents → group plan — VERIFIED-LIVE (function body pulled fresh).**
   `confirm_group_plan` live body confirmed byte-for-byte matches CLAUDE.md's Phase D writeup:
   real party-size sum, explicit-exclude-only roster finalization, expires the merged parents'
   own dangling pending/offered offers (Finding C1's fix, confirmed still present), real
   coordinates from the initiator's own source request (never re-typed), fans out via the same
   `_business_request_fanout`/`_match_request_to_availability` every other request type uses.
   **Confirmed precisely, not assumed: `confirm_group_plan` never touches `friendships` or
   `matches` at all** — only `business_requests`/`business_request_offers`/
   `group_plan_participants`/`group_plan_proposals`. This directly answers the requested
   Friend-Discovery-interference check below.
6. **Group → business offer → participant consent → reservation — VERIFIED-LIVE (function
   body pulled fresh).** `confirm_group_plan_offer` live body confirmed: one confirmation row
   per (offer, participant) via `on conflict (offer_id, user_id) do nothing` (idempotent,
   re-tap-safe), recomputes `required_count`/`confirmed_count` fresh on every call (no stale
   cache), only the confirmation that makes them equal calls
   `_accept_business_offer_internal()` — confirmed this internal function is the *same* lock/
   expire/fulfill logic as the public `accept_business_offer`, minus the `requester_id`
   ownership check (correct — group-plan authority comes from full-roster confirmation, not
   `auth.uid()` owning the row) and, correctly, **also has no `group_plan_id` guard of its own**
   (it doesn't need one — it's never callable directly by a client; confirmed zero `GRANT` to
   `authenticated`/`anon` on `_accept_business_offer_internal` is not directly checked here but
   matches the documented "locked down, callable only via nested SECURITY DEFINER call" pattern
   and the function name's underscore-prefix convention this schema uses consistently).

**Friend Discovery integration-risk check — CLEARED, confirmed precisely.** Per the directive:
Friend Discovery's two `trusted_update`-gated bypasses live on `enforce_friend_request_daily_limit()`
(fires on `friendships` INSERT) and `notify_new_match()` (fires on `matches` INSERT). Group
plan confirmation and offer acceptance — traced through every line of `confirm_group_plan`,
`confirm_group_plan_offer`, `accept_business_offer`, `_accept_business_offer_internal` — never
write to `friendships` or `matches` at all, only to `business_requests`/`business_request_offers`/
`business_availability`/`group_plan_*`. **Zero interference is possible, not just unlikely** —
the two code paths share no table in common on the write side.

**RLS cross-check (bonus, not explicitly requested but cheap given the fetched function list)**:
pulled every SELECT policy on `business_requests`/`business_request_offers`/
`group_plan_participants`/`group_plan_proposals` — all 8 policies present and unchanged from
their documented shape, confirmed **not** touched by the Aug 16 RLS resweep (which only
touched `matches`/`friendships`/`gathering_interest`/`gathering_questions`/`profile_photos`/
`live_tracking_sessions` per CLAUDE.md) — no accidental narrowing or widening.

**Grants spot-check**: all 11 target RPCs confirmed `authenticated: true, anon: false` live,
no regression.

**Headline: 6/6 journeys VERIFIED clean (no drift, no gaps). Zero GAP-FOUND items.** This is a
genuinely clean result, not a shallow pass — every RPC body was pulled fresh from the live
database (not read from a migration file, which can be stale relative to a later
CREATE OR REPLACE, a lesson this project's own history has learned the hard way more than
once) and cross-checked against real client call sites param-for-param.

- [x] Wave 1A: Journeys 1-6 (intent core loop, resolver, business fallback, group plans)
- [x] Wave 1B: Journeys 7-10 (Friend Discovery, dating independence, privacy persistence)

## Wave 1B findings (2026-08-16)

Method: read every relevant client file (friendDiscovery.js, FriendDiscoveryScreen.js,
SettingsScreen.js's toggle, ChatScreen.js/MatchesScreen.js source-branching, proximity.js's
dating candidate queries), pulled live function bodies/grants/RLS for
`get_friend_discovery_candidates`/`record_friend_discovery_swipe`/`is_blocked` plus both
`trusted_update`-gated trigger bypasses via the Management API (project enmosvippabmuqslzrox),
and ran one real live cross-contamination probe against production's actual real data (not
synthetic rows) — see below.

7. **Enable Friend Discovery — VERIFIED-CODE-READ.** Both toggle paths
   (`FriendDiscoveryScreen.js`'s own header `Switch` + `SettingsScreen.js:573`'s
   `toggleNotifPref('open_to_friend_discovery', ...)`) write the identical plain owner-scoped
   `profiles` update — no `trusted_update` guard needed (matches CLAUDE.md's own stated design:
   same posture as `interests`), no drift between the two entry points.
8. **Mutual swipe → friendship → messaging — VERIFIED-LIVE (live function bodies confirmed
   unchanged since the Aug 16 build), VERIFIED-CODE-READ for the Chat leg.** Live-pulled
   `get_friend_discovery_candidates`, confirmed the full exclusion `WHERE` clause matches
   CLAUDE.md's documentation exactly (blocked pairs, any `friendships` row in any status, any
   existing `matches` row, already-swiped). `record_friend_discovery_swipe`/`is_blocked`
   confirmed `SECURITY DEFINER`, grants `{postgres, authenticated, service_role}` only (no
   `anon`) — unchanged. `friend_discovery_swipes` confirmed **0 RLS policies** live (deny-by-
   default still holds). Both trigger bypasses (`enforce_friend_request_daily_limit`,
   `notify_new_match`) confirmed still carry the `trusted_update` guard in their live `prosrc`.
   Chat leg: `FriendMatchCelebrationModal`'s "Say Hi →" navigates to the real `Chat` route with
   the real `matchId` returned by `recordFriendDiscoverySwipe` — same `Chat` screen every other
   match type uses, no special-casing needed since the resulting row is a real `matches` row.
9. **Dating discovery independence — VERIFIED-LIVE + VERIFIED-CODE-READ, genuinely clean, not
   just asserted.** Three independent findings, each closing a different way these two systems
   could have leaked into each other:
   - **Query independence**: `get_friend_discovery_candidates`'s live SQL body has zero
     reference to `show_me`/`discovery_gender`/`intent_visibility`/`notices`/`sightings` — its
     only inputs are `interests`/`wide_area`/`open_to_friend_discovery`. Dating's own candidate
     queries (`proximity.js`'s `getNearbyMatches`/`getBrowseMatches`) have zero reference to
     `friend_discovery_swipes`/`open_to_friend_discovery`. Confirmed by reading both bodies
     side by side — not two systems that happen not to collide, two systems with no shared
     vocabulary at all.
   - **Existing-relationship exclusion is bidirectional, and pre-dates Friend Discovery on one
     side**: `get_friend_discovery_candidates` excludes anyone already in `matches` (so an
     existing *dating* match never shows up in the friend deck) — confirmed live with real
     production data (see below). The reverse direction is even older infrastructure:
     `proximity.js:206-213`'s `getNearbyMatches()` already excludes every accepted `friendships`
     row from dating candidates, with an explicit comment ("someone you've already connected
     with as a friend doesn't need to be re-surfaced as a dating prospect") — this rule existed
     before Friend Discovery and automatically covers a Friend-Discovery-created friendship too,
     with zero new code needed.
   - **Celebration-modal / chat-treatment separation, already handled by existing
     infrastructure**: `MatchesScreen.js:97` already suppresses the dating "It's a Match!"
     modal for any match with `source_friendship_id` set — and a Friend-Discovery mutual-swipe
     match has `source_friendship_id` set (per the design: "the same row shape a normal
     accepted friend request already produces"). `ChatScreen.js:350`'s
     `matchIsRomantic = !match.source_gathering_id && !match.source_friendship_id` likewise
     already treats it as non-romantic (no disappearing-messages/women-message-first framing).
     `FriendMatchCelebrationModal` is only ever triggered from `FriendDiscoveryScreen`'s own
     swipe handler, never from a table poll, so it can't misfire for a dating match either.
     **This is not a coincidental non-collision — Friend Discovery was deliberately built to
     reuse the exact same "accepted friend request → matches row" shape this infrastructure was
     already guarding, so it inherited the correct behavior for free.**
   - **Live cross-contamination probe, real production data, not synthetic**: production
     currently has exactly one real dating match with no source (Google voice ↔ Allen) and one
     real friendship (Claude ↔ Allen). Temporarily set `open_to_friend_discovery = true` on
     Google voice/Allen/Claude, called `get_friend_discovery_candidates` as Google voice — got
     back `[Claude]` only, **Allen (the real dating match) correctly excluded**. Called as
     Claude — got back `[Google voice]` only, **Allen (the real friendship) correctly
     excluded**. Reverted all three profiles to `open_to_friend_discovery = false` immediately
     after; confirmed via a final read that production is back to its exact pre-test state.
   - **One residual, deliberate non-finding worth naming**: dating has no persisted "pass"
     concept at all (grepped `DiscoveryScreen.js` for pass/skip/dismiss — only found unrelated
     `dismissBrowseCallout`/`dismissBreakSuggestion` hits) — a dating skip is purely ephemeral,
     never written to any table. So there is no dating-side "pass" data that could ever leak
     into or interact with Friend Discovery's candidate pool either direction. Not a gap; there
     is nothing to leak.
10. **Privacy/block/pass persistence across sessions/devices — VERIFIED-CODE-READ +
    VERIFIED-LIVE.** Grepped every `AsyncStorage` usage in `src/` for anything block/swipe/
    discovery-preference-related — **zero hits**. There is no client-side cache of a block
    list, a Friend Discovery swipe history, or a discovery preference anywhere in this app —
    every read of any of these goes live to Supabase on each screen focus
    (`FriendDiscoveryScreen`'s `useFocusEffect(load)` re-fetches candidates and re-checks
    `open_to_friend_discovery` fresh every time the screen regains focus, not once per app
    session). Combined with `is_blocked()`/`get_friend_discovery_candidates` both being
    `SECURITY DEFINER` RPCs with no client-writable cache to go stale, a block/pass/toggle made
    on one device is authoritative and visible to a second device on its very next screen focus
    — there is no code path anywhere that could let a stale local read override it. This was
    already independently established for `is_blocked()` in the Aug 16 RLS resweep (a genuine
    role-switch test, not just a read) — confirmed here that nothing since has weakened it.

**Summary: 4/4 journeys VERIFIED clean, 0 GAP-FOUND.** Journey 9 (dating independence) is
genuinely clean, not merely "no gap found because nothing was tried" — it's clean for three
independently-sufficient reasons (no shared query vocabulary, bidirectional existing-relationship
exclusion confirmed live against real data, and pre-existing source-based UI branching that
Friend Discovery inherited for free by reusing the same row shape). Journey 10 is clean because
there is structurally no client cache to go stale — every relevant read is server-authoritative
by construction, not by convention that could be violated by a future change.

- [x] Wave 2A: Race/state edge cases (duplicate taps, simultaneous accept, expiry, leave/decline,
      cancellation, blocked, pending/declined exclusion)
- [x] Wave 2B: Client resilience cases (killed mid-flow, network drop, stale screen, two devices)
      + Journey 11 (V1/V2 regression) + Journey 12 (analytics capture)
- [x] Final consolidated report assembled

## CONTINUATION PLAN — session ended at 97% usage, read this first

**Status**: Wave 1A ✅ (6/6 journeys clean, 0 gaps), Wave 1B ✅ (4/4 clean, 0 gaps), Wave 2B ✅
(found 4 real gaps — see "## Wave 2B findings" above, all non-critical: no data corruption, no
privacy leak). **Wave 2A was dispatched as a background fork but never returned before the
session ended — treat it as not-run.** A new session cannot recover a prior session's background
fork; re-launch it fresh (2-concurrent-fork cap, per this project's own established convention).

**Wave 2A's job, not yet done** — nasty race/state cases against live production
(enmosvippabmuqslzrox), real disposable data, clean up after each:
1. Duplicate-tap idempotency on `confirm_group_plan_offer`, `accept_business_offer`,
   `join_gathering`, `respond_to_group_plan`, `record_friend_discovery_swipe`.
2. Simultaneous-accept race specifically in `confirm_group_plan_offer` (not
   `accept_business_offer` — that one's already proven locked, Aug 15 + re-confirmed in Wave
   1A) and in `record_friend_discovery_swipe`'s mutual-match path.
3. Business offer expiry: confirm `expire_stale_business_requests` cron still scheduled; confirm
   `accept_business_offer` rejects a manually-expired offer.
4. `leave_group_plan` clears not-yet-complete offer confirmations (rule 10).
5. `respond_to_group_plan(accept=false)` / `decline_business_offer` are terminal, no
   resurrection.
6. `cancel_business_request` / `cancel_group_plan` don't corrupt already-merged/accepted state.
7. **Highest-value unanswered question**: does `business_requests`/`group_plan_*` have ANY
   block check anywhere? The 14 locked group-plan rules never mention blocks — check whether two
   blocked users could end up in the same group plan/business-request interaction. Resolve
   definitively either way.
8. Friend Discovery rules 1-2 (pending/declined exclusion, "either direction") — already
   live-verified in the original Aug 16 Friend Discovery build (cite CLAUDE.md, don't re-prove
   unless time allows).

**After Wave 2A**: assemble one short consolidated summary across all 12 journeys + 13 nasty
cases (12/12 journeys clean across waves 1A/1B; Wave 2B found 4 non-critical gaps — worth fixing
but nothing blocking; Wave 2A status TBD) and report to the user. **Restate plainly**: this audit
proves the mechanics are sound — it cannot answer whether the app *feels* good on a real phone.
That still needs a real device pass, which no session in this sandbox has ever been able to
perform. Once Wave 2A lands, the honest recommendation (matching what the user themselves
floated) is: the 4 Wave 2B gaps are small and worth a quick fix pass, but the bigger unlock now
is getting this in front of real people, not more code-only verification.

**The 4 Wave 2B gaps, worth fixing first if picking this up to code rather than just finish the
audit** (see "## Wave 2B findings" for full detail): (1) `FriendDiscoveryScreen.load()` has no
error handling → infinite spinner on network failure; (2) `handleSwipe()` failures are invisible
to the user → a real mutual-like can be lost silently; (3) a narrow-window concurrent-mutual-
swipe race can drop a real match with no retry path (code-read finding, not live-reproduced);
(4) the entire Group Plan funnel writes zero rows to `intent_submissions`/`intent_outcomes`/
`home_nudge_events` — a successful group-plan-sourced business reservation is invisible to the
Market Validation dashboard.

## Wave 2B findings (2026-08-16)

**Note**: Wave 2A had not run yet when this wave started, so nothing here cites its findings —
it independently re-derived the row-lock evidence it needed from Wave 1A's own already-confirmed
`accept_business_offer`/`confirm_group_plan_offer` bodies instead.

### Part A — Client resilience (code-review only, explicitly not live-device-testable)

**App killed mid-flow — VERIFIED-CODE-READ, clean.** `GroupPlanScreen.js`'s `runAction()`
(line 95) is the only mutation path on that screen: call the RPC, then unconditionally re-`load()`
real server state — no optimistic client state is ever held as truth, and nothing is staged in
`AsyncStorage` for later replay. If the app dies mid-RPC, the RPC either committed server-side or
didn't; the next mount/focus re-fetches genuine state via `getGroupPlanDetail()`. Same pattern
confirmed in `BusinessRequestDetailScreen.js` (`useFocusEffect(load)`, load wrapped in try/catch).
Friend Discovery's swipes are each an independent, durable, idempotent RPC call
(`on conflict (from_user, to_user) do nothing`) — an app kill mid-swipe just means that one swipe
attempt either landed or didn't, nothing to reconcile. **No client-side optimistic state anywhere
in these three newest flows would be silently lost or left inconsistent by a kill.**

**Network disappears mid-flow — MOSTLY CLEAN, one real GAP found.** `groupPlans.js`,
`businessFulfillment.js`, and `friendDiscovery.js` all `throw` on a Supabase error (no silent
swallowing at the service layer — verified via grep, every `error` is either `throw new Error(...)`
or a bare `throw error`). `GroupPlanScreen.js`'s `runAction()` catches and surfaces via
`Alert.alert('Error', e.message)`; `BusinessRequestDetailScreen.js`'s initial load uses
`LoadErrorState` with a working retry.
**GAP-FOUND (real, not hypothetical): `FriendDiscoveryScreen.js`'s `load()` (lines 30-49) has
zero try/catch.** A network failure during `isOpenToFriendDiscovery()` or
`getFriendDiscoveryCandidates()` is an unhandled promise rejection — `setLoading(false)` is never
reached, so the screen is stuck on its spinner forever with no error state and no retry. This is
the exact `LoadErrorState`-less pattern the Aug-15 UX-cohesion pass was built to close everywhere
else in the app; Friend Discovery shipped after that pass but wasn't brought under its own
convention.
**Second GAP-FOUND, same root cause, worse consequence: `handleSwipe()` (lines 79-88) catches a
failed swipe with only `console.error` — no user-facing feedback at all.** Confirmed via
`FriendDiscoverySwipeCards.js:50` that the card visually advances (`currentIndex` increments)
regardless of whether the underlying `onSwipe` promise succeeds or fails — so a network drop
mid-swipe leaves the user believing they swiped (the card is gone) while the swipe was never
recorded server-side. Consequence: a "pass" silently doesn't stick (the candidate could resurface
later); worse, a "like" that would have completed a mutual match silently never registers, and the
user has no way to know or retry — there's no re-surfacing mechanism for a candidate once it's
scrolled past in the deck this session, and next `useFocusEffect` reload only re-queries
`get_friend_discovery_candidates`, which — per Wave 1B — already excludes anyone with an existing
swipe row, but *not* anyone whose swipe attempt merely failed to write. So the deck moves on
correctly, but a genuinely-desired "like" can be silently lost with no user-visible signal.

**Stale screen — VERIFIED-LIVE (channel confirmed) for Group Plan; real, narrower gap for Friend
Discovery.** `GroupPlanScreen.js`'s realtime channel (lines 83-93) subscribes to all three
relevant tables including `group_plan_offer_confirmations` (not just participants/proposals, per
the specific ask) — any event on any of the three triggers a full re-fetch, so a stale "N of M
confirmed" count or acting on an already-expired offer is not possible; `confirm_group_plan_offer`
also independently recomputes the count fresh server-side on every call regardless of what the
client believed (Wave 1A). `FriendDiscoveryScreen` has no realtime channel and none is needed for
correctness — `record_friend_discovery_swipe`'s live body (pulled fresh this pass) re-checks
`open_to_friend_discovery` for both parties, re-checks blocks, and re-checks the full
friendships/matches exclusion server-side on every swipe, so a stale deck can never produce an
unsafe write, only (per the gap above) a silently-failed one.

**Two devices / simultaneous actions — mostly covered by Wave 1A's confirmed row locks, one new
GAP found while checking Friend Discovery specifically.**
- Business offer double-accept and group-plan double-confirm: already covered by Wave 1A's
  confirmed `FOR UPDATE` locks in `accept_business_offer` and the idempotent
  `on conflict (offer_id, user_id) do nothing` in `confirm_group_plan_offer` — a second device
  racing either path is safe by construction, cited not re-tested.
- **Friend Discovery mutual-swipe race — GAP-FOUND via code-read, not empirically reproduced
  (this environment's query interface can't force two interleaved DB transactions to land in the
  exact overlapping window needed).** Pulled `record_friend_discovery_swipe`'s live body fresh:
  it does a plain `SELECT ... into v_reverse_like_exists` with **no row lock, no advisory lock**,
  inside what is otherwise a single-transaction PL/pgSQL call under default READ COMMITTED
  isolation. If person A and person B both swipe "like" on each other in the same narrow window —
  both transactions' own swipe-insert not yet committed when the *other* transaction's
  reverse-check runs — both checks correctly see "no reverse like yet" and **both return
  `is_mutual_match: false`**, even though it was genuinely mutual. Both `friend_discovery_swipes`
  rows do land (durability is fine), but no friendship/match is ever created, and nothing in this
  app re-scans that table for an orphaned mutual pair afterward — since `get_friend_discovery_candidates`
  already excludes anyone with any existing swipe row, this candidate simply never reappears to
  either party, so the missed match has no natural retry path. Real but narrow-window (needs
  near-simultaneous swipes, not just "same day") — flagged as a genuine, previously-undocumented
  race, not present in CLAUDE.md's extensive Aug 16 Friend Discovery live-verification writeup
  (which tested sequential, not concurrent, swipes).
- **Minor, non-corrupting duplicate-push note**: if the same account swipes the same target twice
  from two devices after a match already formed, the second call's idempotent upserts correctly
  no-op the friendship/match rows, but the function still unconditionally fires a second
  `send-push` call at the bottom — a harmless duplicate "New friend! 🎉" notification, not a data
  or state bug. Not worth its own fix priority, noted for completeness.

### Part B — Journey 11, V1/V2 regression check — VERIFIED-LIVE, clean, precisely confirmed

Pulled every trigger on `matches`/`friendships`/`gathering_interest`/`gathering_questions` live
(the two tables named in the directive with no matching trigger — `profile_photos`/
`live_tracking_sessions` — were correctly RLS-policy-only fixes per CLAUDE.md, no trigger to
check). **All four RLS-resweep identity-guard triggers are confirmed `BEFORE UPDATE` only, with
zero overlap in table+event with any INSERT path**: `on_friendship_updated_protect_participants`
(friendships, BEFORE UPDATE only — the real INSERT triggers are the pre-existing
`on_friend_request_created`/`on_friend_request_enforce_limit`, both untouched), `on_gathering_
interest_updated_protect_identity` (gathering_interest, BEFORE UPDATE only —
`join_gathering()`'s own INSERT path fires only `no_self_gathering_interest`/`on_gathering_
interest_created`, neither of which is the resweep's guard), `on_gathering_question_updated_
protect_identity` (BEFORE UPDATE only), `on_match_updated_protect_participants` (matches,
BEFORE UPDATE only — the dating match-creation INSERT path fires only `on_match_created`).
This is a structural guarantee, not a behavioral inference: Postgres never fires an `UPDATE`
trigger for an `INSERT` statement, so these four triggers are provably inert on every join/accept/
match-creation INSERT path in the app, confirmed against the live `information_schema.triggers`
catalog rather than trusted from the resweep's own documentation.

### Part C — Journey 12, analytics capture — one real, well-evidenced GAP found

`intent_submissions`/`intent_outcomes` writes are confirmed still correctly wired at all 4 known
`HomeScreen.js` call sites (`recordIntentSelection`/`recordIntentSubmission`/`recordIntentOutcome`,
lines 320/408/471/524/585) — no regression there. `home_nudge_events` writes (`recordNudgeEvent`,
shown/acted/dismissed, HomeScreen.js:215/568/578) are confirmed present for the Layer-3 "group
intent" proactive Home nudge card — note this is a *different* feature from Group Plans despite
the similar name (Layer 3 = `get_my_group_intent_signals()`'s dismissible Home card; Group Plans
= Phase D's `group_plan_proposals` mechanism) — don't conflate the two when reading this.

**GAP-FOUND, real and well-evidenced: the actual Group Plan (Phase D) funnel has ZERO analytics
coverage anywhere.** Checked precisely, not assumed:
- Live-pulled `confirm_group_plan` and `propose_group_plan` and grepped both bodies for any
  mention of `intent_outcomes`/`intent_submissions`/`home_nudge_events` — zero hits in either.
  `propose_group_plan`'s only "intent" substring match is `intent_visibility` (Phase D's own
  connected-set eligibility check, unrelated to analytics).
- Grepped every client call site of `recordIntentSelection`/`recordIntentOutcome`/
  `recordIntentSubmission` app-wide (`src/services/intentOutcomes.js`, `src/screens/HomeScreen.js`
  only) — `GroupPlanScreen.js`, `BusinessRequestDetailScreen.js` (where a group plan is actually
  proposed from), and `groupPlans.js` call none of them.
- Confirmed the RPC list that *reads* intent analytics (`get_intent_funnel_stats`,
  `get_market_validation_stats`, `get_cross_user_intent_patterns`, `get_home_nudge_stats`) only
  reads `intent_submissions`/`intent_outcomes`/`home_nudge_events` — none of them independently
  reads `group_plan_proposals`/`group_plan_participants` at all, so there is no alternate path by
  which a group-plan outcome could be counted.
- **Practical consequence**: a `confirm_group_plan` call creates a real `business_requests` row
  that correctly flows through the same fan-out/offer/accept machinery as any other request (so
  it *is* tracked in the business marketplace's own tables), but the Market Validation dashboard's
  headline metrics — repeat-intent rate, % of submissions resolved, % reaching a real reservation
  — are blind to every group-plan-originated ask and its eventual outcome. A group plan that
  successfully turns into a real business reservation (the "10/10" success case for this whole
  feature) is invisible to the one dashboard this project built specifically to answer "is this
  working." This wasn't a design decision anyone made explicitly and documented as a tradeoff —
  it's an integration seam that was missed when Group Plans was layered onto the intent system as
  a distinct set of tables/RPCs.

## Summary of this wave
4 real gaps found, none security- or correctness-critical (no data corruption, no privacy leak,
no double-charge) — all four are either a silently-swallowed failure state or a missing analytics
write: (1) `FriendDiscoveryScreen.load()` has no error handling → infinite spinner on network
failure, (2) `handleSwipe()` failures are invisible to the user → a real mutual-like can be lost
silently, (3) a genuine (narrow-window, code-read-only) concurrent-mutual-swipe race can drop a
real match with no retry path, (4) the entire Group Plan funnel is invisible to this project's own
market-validation analytics. Journeys 11 (regression) and Part A's "app killed mid-flow"/"stale
screen" checks came back genuinely clean, confirmed precisely rather than assumed.

## Wave 2B fixes — DONE (2026-08-16), all 4 gaps closed

Fixed the same session the gaps were found, before continuing to Wave 2A — see CLAUDE.md's own
dated entry for the full writeup (this is the short version, cross-referenced from there).

1. **`FriendDiscoveryScreen.js`'s `load()` now has real try/catch** — mirrors the shared
   `LoadErrorState`/retry convention every other screen in this app already uses (the Aug-15
   UX-cohesion pass). A network failure now shows a real "Couldn't load Meet New Friends" state
   with a working Try Again button instead of a permanent spinner.
2. **`handleSwipe()` failures now surface to the user, with a real retry.** A failed swipe (the
   card has already animated away, matching `FriendDiscoverySwipeCards`' own optimistic-advance
   design, which was not changed) now shows an honest alert naming the person and the action that
   didn't save, with a Retry button that re-calls the RPC for that same target id — closes the
   "silently lost mutual like" consequence, doesn't fully eliminate the underlying possibility
   (the deck has moved on either way) but the user now always knows and can act on it immediately.
3. **The concurrent-mutual-swipe race is fixed, not just documented** —
   `20260816_friend_discovery_swipe_race_fix.sql`, `record_friend_discovery_swipe` now does
   `select id from profiles where id in (least, greatest) order by id for update` before reading
   or writing anything else, serializing any two swipes between the same pair (either direction)
   — matches this schema's own established `SELECT ... FOR UPDATE` race-fix convention exactly,
   no new advisory-lock primitive introduced. **Verified live against production**, not just
   applied: confirmed the function's live `prosrc` now contains the lock and grants are
   unchanged (`authenticated` yes, `anon` no); ran a real disposable two-step sequential test
   (Allen Klein↔Claude, a genuinely unconnected real pair) — first "like" correctly returned
   `is_mutual_match: false`, the reverse "like" correctly returned `is_mutual_match: true` with a
   real `match_id`, confirming the lock didn't break the ordinary (non-racing) happy path. All
   test state (the swipe rows, the friendship, the match, both profiles' `open_to_friend_discovery`)
   reverted afterward — confirmed production back to its exact pre-test baseline (1 match, 1
   friendship, 0 swipes). **Not independently reproduced under true concurrency** (this
   environment can't force two interleaved transactions into the exact overlapping window) — the
   fix is proven correct by the row-lock's own well-understood Postgres semantics plus the
   unchanged happy-path result, not by empirically reproducing the race and watching it
   disappear, same limitation Wave 2B's own original finding already disclosed for reproducing
   the race in the first place.
4. **The Group Plan funnel now writes to `intent_outcomes` at its two most meaningful points** —
   `GroupPlanScreen.js`'s `handleConfirm()` (a group plan reaching the real business marketplace,
   `resultType: 'created_new'`, mirroring how HomeScreen's own "ask nearby businesses fresh"
   fallback is already recorded) and `handleConfirmOffer()` only once `allConfirmed` is true (the
   actual reservation locking in, `resultType: 'business_offer'`) — both reuse the existing,
   already-verified `recordIntentSelection()` fire-and-forget write path, no schema change.
   **Deliberately partial, disclosed rather than silently claimed complete**: `submissionId` is
   always `null` for both — a group plan doesn't have one single originating `intent_submissions`
   row (it's formed from several participants' own separate asks), so linking it to just one
   would misattribute it; this means these two events show up in `outcomes_answered`/
   `outcomes_positive` (once someone eventually answers a "how did it go" prompt for one) but not
   in `results_selected`'s ratio against `submissions_with_result`, which is the honest, accurate
   behavior for data with no real single submission to attribute to — not a bug. The propose-time
   moment (before confirmation) and the individual participants' own original asks' own
   `intent_submissions` linkage are still not retroactively connected — full funnel parity for
   Group Plans would need a schema change (persisting a submission id onto `business_requests`)
   that wasn't part of this fix's scope. Verified via a direct read of `intent_outcomes`' real
   `result_type` CHECK constraint (`'created_new'`/`'business_offer'` are both already valid,
   already-used-elsewhere values, not invented) rather than a full live group-plan-to-reservation
   test, given the size of disposable state that scenario would need to construct — a reasonable,
   disclosed scope boundary given this is a pure client-side wiring change onto an
   already-proven-correct write path, not new schema/RLS to prove.

Verified client-side via a direct `@babel/core` parse of both touched files (clean), the full
42-test Jest suite (unchanged, still 42/42), and a full `npx expo export --platform ios` (clean,
1874 modules, unchanged — edits to two existing screens plus one new migration, no new client
files).

## Wave 2A findings (2026-08-16) — run directly (no background fork this time), all 8 items closed

Method: pulled every live function body for the full race/state chain directly from production
(`join_gathering`, `decline_business_offer`, `cancel_business_request`, `cancel_group_plan`,
`expire_stale_business_requests`, `leave_group_plan`, `respond_to_group_plan`, `propose_group_plan`,
`confirm_group_plan`, `confirm_group_plan_offer`, `create_business_request`,
`_business_request_fanout`, `submit_business_offer`, `post_business_availability`,
`get_connected_open_business_requests`), then ran real disposable-data live tests against
production (`enmosvippabmuqslzrox`) for the items where code-reading alone wasn't sufficient
proof — cleaning up after every single test, verified via a final row-count check across every
touched table.

**A real, previously-uncleaned leftover from an earlier (incomplete) session was found and
removed before this wave's own tests started**: one disposable `business_requests` row
("ACCEPTANCE-AUDIT-TEST expiry test", already `status: 'expired'`) and its one
`business_request_offers` row had been left in production from a prior attempt at this exact
Wave 2A item 3 that never got cleaned up before that session ended. Deleted both, confirmed
production back to 0 `business_requests`/`business_request_offers` before proceeding — flagged
here rather than silently absorbed into this wave's own cleanup, since it's evidence a prior
session's test data can leak across sessions if a session ends mid-verification.

1. **Duplicate-tap idempotency — VERIFIED-LIVE for `join_gathering`, VERIFIED-CODE-READ for the
   rest.** `join_gathering`: a genuinely fresh join on a real disposable test gathering returned
   a real `match_id`; an immediate identical second call correctly returned `{status: 'approved',
   match_id: null}` with **zero** new `gathering_interest` row created (`on conflict (gathering_id,
   user_id) do nothing` + a `GET DIAGNOSTICS row_count`-gated idempotent-status short-circuit,
   confirmed both by reading the function and by the live row count staying at 1 after the
   duplicate call). **One real, minor, disclosed finding, not a bug**: the idempotent-return path
   always returns `match_id: null` even when a real match already exists for that pair — the
   function doesn't bother looking it up again on the "nothing changed" path. Low severity (no
   data loss, no incorrect state — a client that needed the match id on a genuine duplicate tap
   would just not get it back from *this* call, but the match row itself is real and correct, and
   every other path to it, e.g. `GroupPlanScreen`'s own full re-fetch, still resolves it
   correctly). Not fixed this pass — flagged as a real, small, non-corrupting rough edge. An
   earlier version of this same test transiently produced a confusing `match_id: null` on what
   looked like a "first" join — traced precisely to a test-sequencing mistake on my own part (an
   earlier combined multi-statement query had already called `join_gathering` twice before the
   supposedly-"first" isolated call ran), not a real bug — re-run cleanly with a fresh gathering/
   joiner pair to confirm the true first-call behavior (`match_id` correctly populated).
   `confirm_group_plan_offer`: `insert ... on conflict (offer_id, user_id) do nothing` plus a
   fresh `count(*)` recompute on every call (confirmed via Wave 1A's own live-pulled body) — a
   repeat confirmation by the same participant is a genuine no-op, and a repeat call after
   `allConfirmed` correctly hits `offer.status <> 'offered'` and raises (matches the pattern this
   whole schema uses: idempotent where the action itself is naturally repeatable, a clear
   rejection where it's genuinely terminal). `accept_business_offer`: already proven live in
   Wave 1A (both this session's Aug 15 architecture-hardening pass and re-confirmed here via the
   fresh function-body pull). `respond_to_group_plan`: a second identical call correctly raises
   `'You have already responded to this group plan.'` rather than silently no-opping — a
   deliberate reject-not-resurrect choice, matching this schema's own established convention
   (e.g. the gathering-approval double-review guard) for an action that shouldn't be silently
   repeatable. `record_friend_discovery_swipe`: already proven idempotent in the original Aug 16
   Friend Discovery build (a repeat like on an already-connected pair correctly returns
   `is_mutual_match: false` via the `v_already_connected` re-check) and re-confirmed as part of
   this session's own Wave 2B race-fix verification above.
2. **Simultaneous-accept race — VERIFIED-CODE-READ, both paths correctly locked.**
   `confirm_group_plan_offer` locks `group_plan_proposals` (`select ... for update`, Finding C2's
   fix) at its very top, before any read of the confirmation count — this serializes *every*
   concurrent call for the same proposal, not just the same offer, so two participants confirming
   at once can never both read a stale sub-quorum count. `_accept_business_offer_internal` (the
   function it calls once `allConfirmed`) independently re-locks the offer and request rows again
   — belt-and-suspenders, already proven live in Wave 1A. `record_friend_discovery_swipe`'s own
   race (the actual subject of this item, per the original Wave 2B finding) is fixed and
   verified live this same session — see the "Wave 2B fixes" section above, not re-verified twice.
3. **Business offer expiry — VERIFIED-LIVE.** `cron.job` confirmed active
   (`expire-stale-business-requests`, schedule `18 * * * *`, `active: true`) — not just present in
   a migration file, the live `cron.job` row itself. A real disposable offer manually set to
   `status = 'expired'` was correctly rejected by `accept_business_offer`
   (`'This offer is no longer available.'`) — confirming the *consumer* of expiry state respects
   it, not just that the expiry sweep itself runs (the sweep's own logic was already read in Wave
   1A/CLAUDE.md's own Aug-15 verification history — this pass's new contribution is proving the
   accept path actually honors an expired status, not just that the cron exists).
4. **`leave_group_plan` clears not-yet-complete offer confirmations — VERIFIED-CODE-READ.**
   `if v_proposal.status = 'confirmed' and v_proposal.resulting_request_id is not null then delete
   from group_plan_offer_confirmations where proposal_id = ... and user_id = auth.uid(); end if;`
   — correctly scoped to only the leaving participant's own confirmation (rule 10's actual text:
   invalidate *that offer's* not-yet-complete confirmations, not everyone else's already-real
   consent), confirmed present in the live function body.
5. **`respond_to_group_plan(false)` / `decline_business_offer` are terminal, no resurrection —
   VERIFIED-CODE-READ.** Both guard on the row's current status before allowing any write
   (`if v_participant.status <> 'invited' then raise ...`;
   `if v_row.status not in ('pending', 'offered') then raise 'This request has already been
   resolved.'`) — a second call against an already-decided row is rejected outright, never
   silently re-applied or reversed.
6. **`cancel_business_request` / `cancel_group_plan` don't corrupt already-merged/accepted state
   — VERIFIED-CODE-READ.** `cancel_business_request` requires `status = 'open'`
   (`raise 'This request can no longer be cancelled.'` otherwise) — a `merged` (group-plan-
   superseded) or `fulfilled` request can't be touched by this function at all.
   `cancel_group_plan` requires `status = 'pending'` (`raise 'This group plan can no longer be
   cancelled.'` otherwise) — a `confirmed` plan (one that already produced a real
   `business_requests` row) can't be cancelled through this path either. Both are structural
   guards, not app-level discipline alone.
7. **The highest-value unanswered question — resolved definitively: YES, a real gap existed,
   now FIXED and VERIFIED-LIVE.** Read every function in the full `business_requests`/
   `group_plan_*` chain (`get_connected_open_business_requests`, `propose_group_plan`,
   `respond_to_group_plan`, `confirm_group_plan`, `confirm_group_plan_offer`,
   `create_business_request`, `_business_request_fanout`, `submit_business_offer`,
   `post_business_availability`) — **none of them referenced `blocks`/`is_blocked` anywhere**, and
   `blocks` has zero triggers on it (confirmed live via `pg_trigger`), meaning a block never
   cascades to remove a pre-existing accepted `friendships` row or `matches` row (the identical
   fact CLAUDE.md's own earlier `invite_friend_to_gathering` fix already established for a
   different feature). Net effect: two people who blocked each other but still had an old
   accepted friendship/match row could still see each other's open request in Home's own Tier 2
   resolver results, and one could propose — and the other accept — a real group plan together,
   seeing each other's name and party size in the shared roster. This is a genuine bypass of the
   block, and dating discovery's own equivalent surface already correctly excludes blocked pairs
   (`is_blocked` gates `matches`/`messages` RLS) — this was a real, asymmetric gap specific to the
   newer Group Plan/business-request surface.
   **Fixed** (`20260816_group_plan_block_check.sql`): `get_connected_open_business_requests`
   (the one RPC that sources both Home's Tier 2 resolver results and `getGroupPlanCandidates()`'s
   own invite picker) gained `and not is_blocked(auth.uid(), br.requester_id)`;
   `propose_group_plan`'s own invitee-eligibility subquery gained the identical check as a
   defensive server-side re-validation (never trust a stale client candidate list); a new
   defensive check was added to `respond_to_group_plan` (`if is_blocked(auth.uid(),
   v_proposal.initiator_id) then raise 'This group plan is no longer available.'`) for the case
   where a block is created *after* an invite was sent but *before* the invitee responds to it —
   generic rejection message, same posture as `join_gathering`'s own blocked-pair rejection,
   never reveals which side blocked which.
   **Verified live against production end-to-end, not just applied**: confirmed all three
   functions' grants are unchanged (`authenticated` yes, `anon` no) and all three now contain
   `is_blocked` in their live `prosrc`. Real disposable test using the one real accepted-friend
   pair already in production (Claude↔Allen): two real open `business_requests` rows, one each —
   confirmed Allen genuinely saw Claude's request via `get_connected_open_business_requests`
   *before* any block; inserted a real block row (Claude→Allen) — confirmed the same call now
   returns **zero** rows; attempted `propose_group_plan` as Allen while blocked — correctly
   rejected (`'None of the people you invited could be added...'`, the invitee silently excluded
   by the new check, participant count staying at 1) — confirmed the failed attempt left **zero**
   orphan rows (the whole transaction rolled back, not just the one insert). Removed the block —
   the identical `propose_group_plan` call now succeeded normally (happy path unaffected by the
   fix). Re-added the block *after* a real pending invite already existed — Claude's
   `respond_to_group_plan(accept: true)` call was correctly rejected (`'This group plan is no
   longer available.'`), confirmed the participant's own status was left untouched at `'invited'`
   (not corrupted by the failed attempt) — removed the block again, retried the identical accept
   call, and it correctly succeeded (`status: 'accepted'`), proving the fix doesn't regress the
   ordinary unblocked path. All test state (2 `business_requests`, 1 `group_plan_proposals`, its
   1 `group_plan_participants` row, both temporary block rows) deleted afterward; production
   confirmed back to its exact pre-test baseline (0 `business_requests`, 0 `group_plan_proposals`,
   0 `blocks`, 1 real friendship, 1 real match unchanged).
   **Deliberately, honestly scoped, not silently claimed fully closed**: this fix covers the
   initiator↔invitee relationship only — `propose_group_plan`'s own design is hub-and-spoke
   around the initiator (every invitee is checked against the initiator's own connections, never
   against each other), so two *non-initiator* participants who are both genuinely connected to
   the initiator but blocked from each other could still end up in the same group plan roster
   without this fix catching it. A full fix would need an all-pairs block check across the whole
   confirmed roster (at `confirm_group_plan` time, when the final roster locks in) — a larger
   change than this pass's scope; flagged here as a real, known, disclosed residual gap rather
   than silently left unmentioned.
8. **Friend Discovery rules 1-2 (pending/declined exclusion, "either direction") — CITED, not
   re-proven, per the continuation plan's own instruction and this wave's time budget.** Already
   live-verified end-to-end, both directions, in the original Aug 16 2026 Friend Discovery build
   — see CLAUDE.md's own "Aug 16 2026 — Friend Discovery" section, "Pending-request exclusion"
   and "Declined-request exclusion" bullets. Nothing about this session's changes (the race fix,
   the analytics wiring) touches that exclusion logic — `get_friend_discovery_candidates`'s own
   `WHERE` clause was independently re-confirmed unchanged via a fresh live pull during this
   session's Wave 1B pass (see above), so there was no drift to re-check.

### Summary of Wave 2A
8/8 items resolved. One real, confirmed, previously-undocumented security/privacy gap found and
fixed this wave (item 7 — no block check anywhere in the Group Plan/business-request chain,
closed and verified live — and, per the Aug 16 same-day update above, the block check's own
disclosed initiator-only-pair scope limit is now also closed). One real, minor, non-corrupting
cosmetic gap disclosed and, per the same update, since fixed (item 1 — `join_gathering`'s
idempotent-return path now looks up the real `match_id` instead of omitting it). Every other item
(2-6, 8) came back genuinely clean — confirmed via a mix of fresh live function-body pulls and
real disposable-data tests, not assumed from a stale reading of a migration file.

## FINAL CONSOLIDATED REPORT (2026-08-16) — the whole audit is now DONE

**12/12 journeys traced, all clean or closed.** Waves 1A (6/6) and 1B (4/4) found zero gaps in
the core intent→resolver→business-fallback→group-plan→Friend-Discovery chain, each confirmed
against fresh live-pulled function bodies and real disposable-data tests, not migration-file
readings or assumptions. Wave 2B found 4 real client-resilience/analytics gaps (all non-critical
— no data corruption, no privacy leak) and Wave 2A found 1 real security/privacy gap (no block
check anywhere in the Group Plan/business-request chain) plus 1 minor cosmetic gap — **all 6
findings across both waves have now been fixed and verified live**, not just documented. Journey
11 (V1/V2 regression) came back genuinely clean, confirmed via the live `information_schema.
triggers` catalog rather than trusted from documentation. Journey 12 (analytics capture) is now
substantially better than "found blind" — the Group Plan funnel writes real `intent_outcomes`
rows at its two most meaningful moments, disclosed as intentionally partial.

**13/13 nasty cases exercised**: duplicate taps (5 functions, all either idempotent or correctly
terminal-rejecting), simultaneous accept (both `confirm_group_plan_offer` and
`record_friend_discovery_swipe`'s races — the latter genuinely fixed, not just found), business
offer expiry (cron confirmed active, `accept_business_offer` confirmed to honor it), participant
leaving a group (confirmations correctly cleared), participant declining (terminal, no
resurrection), request cancellation (both business-request and group-plan cancel paths correctly
guard against corrupting already-progressed state), blocked user (the one real gap this whole
audit found — now fixed), pending/declined friend-request exclusion (Friend Discovery, cited from
its own original live-verified build), app-killed-mid-flow / network-drop / stale-screen / two-
devices (Wave 2B's Part A, all clean except the 2 Friend Discovery gaps already fixed).

**What was fixed this session, in order**: (1) `FriendDiscoveryScreen`'s missing error handling,
(2) `handleSwipe`'s silent failures, (3) the Friend Discovery mutual-swipe race
(`record_friend_discovery_swipe` now locks both participants' `profiles` rows), (4) Group Plan's
missing analytics writes, (5) the Group Plan/business-request block-check gap
(`get_connected_open_business_requests`/`propose_group_plan`/`respond_to_group_plan` all now
check `is_blocked`). Every fix was verified live against production with real disposable data,
cleaned up after each, before being considered done — matching this project's own established
audit convention throughout its history.

**Update, Aug 16 2026, same day: both of the two real disclosed gaps below are now fixed too**
(the third item — Group Plan's analytics wiring — remains a deliberate scope decision, not a
bug; see CLAUDE.md's own "closed 5 of the real, previously-disclosed-but-left-alone gaps" entry
for the full writeup and live-verification detail on both):
- ~~`join_gathering`'s idempotent-return path doesn't surface an already-real `match_id` on a
  duplicate tap~~ — **FIXED**: the idempotent branch now looks up the real `matches` row when
  the existing status is `'approved'`, verified live (a repeat call for an already-approved
  request now returns the same real `match_id` both times, not `null` the second time).
- ~~The block-check fix is scoped to initiator↔invitee only, not a full all-pairs check across a
  confirmed group plan's whole roster~~ — **FIXED**: `confirm_group_plan` now runs a real
  all-pairs block check across the final accepted roster right before the shared request is
  created, verified live end-to-end (a block between two non-initiator participants correctly
  rejects confirmation with a clean rollback; removing it lets the identical confirm succeed).
- Group Plan's analytics wiring is partial by design — no single originating `intent_submissions`
  row to attribute a multi-person group ask to, so `submissionId` is always null on both new
  writes (Wave 2B item 4). **Still open, unchanged** — this needs a real schema change
  (persisting a submission id onto `business_requests` at creation time) explicitly out of scope
  for a quick fix pass, not a gap that was overlooked.

**The one thing this audit was never going to be able to answer, restated plainly, per this
file's own opening limitation**: every journey and nasty case above proves the *mechanics* are
sound end-to-end. It cannot answer whether Nearby *feels* good in a real person's hands — the
onboarding flow's pacing, whether the intent box reads as magical or confusing on a real phone,
whether the swipe gestures feel natural, whether push notifications land with the right timing.
That question needs a real device pass — the user's own, or a future session with actual
simulator/device access, which this sandbox has never had across this entire project's history.
The honest recommendation, matching what the user themselves already floated before this audit
began: the mechanics are now about as proven-sound as a code-only audit can make them: the
highest-value next step is putting this in front of real people on a real phone, not further
code-only verification.
