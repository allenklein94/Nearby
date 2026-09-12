# Item 59 — "Thursday acceptance test": 5 end-to-end journey traces

Started 2026-09-12. No simulator/device tooling available this session (standing note across
this whole project) — these are full code traces of the real navigation/state flow for each
journey, screen by screen, params in hand, not an on-device run. Disclosed plainly, not silently
substituted for the real thing.

Progress tracker (updated as each journey fork reports back):

- [x] Journey A — Dating: People → Dating → person → match → message → Plan → business/place → plan
- [x] Journey B — Friends: People → Friends → friend → message → Plan → activity/business → plan
- [x] Journey C — Discover: Discover → Things To Do → Today → category → activity → Plan
- [x] Journey D — Create: Discover → can't find it → Create → Gathering/Community → publish
- [x] Journey E — Business: Intent → options → business → offer/availability → reservation/plan

Findings and fixes land below each journey's checkbox as it completes.

## Journey A — Dating

Traced `DiscoverHubScreen.js` → `DiscoveryScreen.js` → `SwipeableDiscoveryCards.js` →
`MatchesScreen.js`/push routing → `ChatScreen.js` → `DateProposalScreen.js`.

- **Hop 1** (People → Dating → tap person → profile): **Clean.** Swipe (`SwipeableDiscoveryCards.js:43-60`,
  fires `onNotice`) and tap-to-view-profile (`:158-161` → `DiscoveryScreen.js:606` →
  `navigate('ViewProfile', { userId, viewContext: 'dating' })`) are cleanly separated.
- **Hop 2** (swipe → match): **Weak, but intentional, not a bug.** A swipe only ever sends a
  "Notice" (`SwipeableDiscoveryCards.js:63-67`) — real match creation is async/server-side. The
  client only learns about a new match via a push (skips celebration UI entirely) or by opening
  Matches (a separate tab under Messages, not under People/Discover), where `MatchesScreen.js:115-158`
  diffs against remembered seen-ids and shows `MatchCelebrationModal` (`:475-479`). Worth knowing:
  the journey's "person → match" reads as same-flow, but real behavior is an out-of-band reveal.
- **Hop 3** (message): **Clean.** Both real entry points (push routing, `MatchesScreen.js:241-246`)
  correctly pass `matchId`; `ChatScreen.js:107` reads it correctly.
- **Hop 4** (Plan Together): **Weak — the one real friction found.** "Plan Together"
  (`MatchesScreen.js:253-259` and the match row's own button) navigates to `Chat` with
  `openTogetherMenu: true`, which opens a generic 12-option "Together" `ActionSheetModal`
  (`ChatScreen.js:520-538`) — "Plan Something Together" is option **#12 of 12**, buried under 11
  unrelated options (Shared Playlist, Trip Planning, etc.) instead of a direct hop to
  `DateProposalScreen`.
- **Hop 5** (find a place): **Clean.** `DateProposalScreen.js`'s find/choose/propose chain
  (`:175-215`) carries every param correctly in one call, no drops.
- **Hop 6** (final state): **Clean.** Re-renders in place with real "View Request"/"Find Somewhere
  to Go" actions; reachable again later via Plans (Item 52's `datePlans`).

**Punch list**: (1) "Plan Together" should skip the generic Together menu and land directly on
`DateProposalScreen` — real, fixable, not yet fixed (design call: skip menu entirely vs.
pre-highlight the row). (2) Match reveal being async/out-of-band is disclosed as intentional, not
treated as a bug.

## Journey B — Friends (in progress, resumed after codespace restart)

**Bug found and fixed this session**: `create_plan_from_date_proposal()` (the trigger behind every
date-proposal-sourced `plans` row) unconditionally inserted `plan_type = 'dating_date'` even when
the underlying `matches` row was friend-sourced (`source_friendship_id` set) or gathering-sourced
(`source_gathering_id` set) — the same real/fake distinction `ChatScreen.js`'s own
`isRomanticMatch` already makes for the same match row. Consequence: every "Plan Something
Together" made from a Friends-tab connection landed on the Plans tab permanently mislabeled with a
heart icon and "Date." Fixed in `supabase/migrations/20261015_friend_sourced_plan_type_fix.sql`
(trigger now branches on the match's own source columns; a real backfill UPDATE included, though
production currently has zero existing date-proposal-sourced plans rows so it was a no-op) +
`src/services/plans.js`'s `getMyDateProposalPlans()` (now selects `plan_type`, fetches both
`dating_date` and `friend_hangout`) + `src/screens/PlansScreen.js`'s `datePlanRow` render (now
branches icon/label on `plan.plan_type`). **Verified live** via a disposable rolled-back
transaction against production covering all 3 cases (friendship-sourced match → `friend_hangout`;
gathering-sourced match → `friend_hangout`; plain dating match → `dating_date`) — all 3 assertions
passed. Migration was already applied live to production before the restart (confirmed via
`pg_get_functiondef`); this session's work closed the two client-side pieces the migration's own
header comment had promised ("fixed in the same client change") but that hadn't actually landed
yet.

**Second round of bugs found (background research fork) and fixed**: `DateProposalScreen.js`,
`MatchesScreen.js`, `ViewProfileScreen.js`, `AskBusinessScreen.js`, `BusinessRequestDetailScreen.js`,
`FriendsScreen.js` were all confirmed already clean (correctly `isRomanticMatch`-gated or entirely
neutral). Three real leaks found in `ChatScreen.js`'s "Do Something Together" menu
(`togetherMenuOptions`) and its sibling safety-check-in feature, both reachable from a
friend/gathering-sourced chat with zero gating:

1. **The Together menu showed 7 explicitly romantic-relationship tools to friends** — "Leave
   Relationship Wisdom," "Log a Chemistry Check-In," "Our Constitution," "Timeline Thoughts,"
   "Memory Vault," "What If... Scenarios," "Big Picture Chat." These aren't just mislabeled —
   their actual content is romantic-relationship-specific by construction (checked each
   destination screen's own categories/placeholders: `RelationshipConstitution`'s categories are
   "How We Handle Conflict"/"How We Make Big Decisions"; `TimelinePlanner`'s are month1/month6/
   year1/year3 relationship milestones; `MemoryVault`'s own placeholder text is "our first
   conversation, first date"; `SharedDecisions` ("Big Picture Chat") covers "Where to Live"/
   "Finances" cohabitation decisions). Fixed by adding a `romanticOnly` flag to each and filtering
   the array on `isRomanticMatch`, the same precedent `courageMenuOptions` already established for
   "Ask them out"/"Say I'm interested." "Suggest a Date Night" was adapted rather than hidden
   (relabeled "Suggest Something To Do" + its inserted chat message reworded from "Date night
   ideas" to "Ideas nearby" for non-romantic matches) since its actual mechanic — matching shared
   interests to nearby business offers — is genuinely valid for friends too, unlike the 7 hidden
   ones. Shared Playlist/Plan a Trip/Suggest an Activity were already neutral, confirmed by reading
   their own category lists, and stay visible for everyone.
2. **The header shield icon ("🛡️") opening `DateCheckInModal` was completely ungated**, with
   `accessibilityLabel="Set up a date safety check-in"` and the modal itself unconditionally
   titled "🛡️ Date Safety Check-In," describing "your date" throughout, plus a scheduled push
   notification titled "How did your date go?" (`dateSafety.js`'s `createCheckIn`). This is a
   genuine universal in-person-meetup safety feature, not a dating-only one, so the fix adapts
   copy rather than removing it for friends (removing a safety feature nobody asked to remove
   would be a worse outcome than the copy bug itself): `DateCheckInModal` now takes an
   `isRomanticMatch` prop (passed from `ChatScreen.js`'s own existing state) and swaps
   title/description/post-submit-alert/notification-title to neutral "Safety Check-In"/"meeting
   up"/"How did it go?" wording when false. `buildShareMessage()`'s outbound SMS text was already
   neutral ("I'm meeting someone named X") — confirmed correct, not touched.

All three fixes verified via full Jest suite (295/295 passing) + a direct `@babel/core` +
`babel-preset-expo` transform check on all three touched files (`ChatScreen.js`,
`DateCheckInModal.js`, `dateSafety.js`) — no live DB involved, pure client copy/gating logic. Not
exercised in a running app (no simulator/device tooling this session, standing note).

**Journey B verdict**: with these fixes, clean — friend hangout flow (message → Do Something →
Plan Something Together → find a business) carries no dating language anywhere in the traced path.

## Journey C — Discover

Traced `DiscoverHubScreen.js` (Today section) → `GatheringDetailScreen.js` → business-connection
screens. One correction to the journey's own literal wording: there's no category *chip* inside
Today specifically — Today renders real activity tiles directly (`todayGatherings.map(renderGatheringTile)`,
`DiscoverHubScreen.js:1779-1791`); the standalone chip-based Categories row is its own separate
section below This Weekend. The real Today interaction is "tap an activity tile," which invokes
the same expand-in-place mechanism (`openContextFor`, `:370-388`) scoped to that tile's own
category — functionally equivalent to what the journey describes.

**Hop count: clean, 2 real screen pushes, no gratuitous intermediate.**
1. Today tile tap → expand in place (`openContextFor`, `DiscoverHubScreen.js:1219`/`:1288`) — no
   navigation.
2. Expanded-context row tap → `GatheringDetail` (real push #1) —
   `renderContextGatheringRow`, `DiscoverHubScreen.js:1163`.
3. `GatheringDetailScreen`'s "🏪 Find a Business for This Plan" (`:956`) expands a two-option
   chooser in place (no navigation) — the Item 33-audited merged front door.
4. Chooser option tap → `RequestBusinessPartner` or `AskBusiness` (real push #2) — `:964`/`:976-982`.

**Real gap found, disclosed rather than silently fixed**: the entire "Find a Business for This
Plan" CTA block is gated on `gathering.isHost` (`GatheringDetailScreen.js:782`) — intentional,
matches this app's existing model that a *group-level* business partnership decision for a
gathering is the host's own call to make (the "each actor only ever reports its own side's state"
convention, applied at the gathering-owner level). But it means a user who discovers someone
*else's* public gathering via Today/Categories — the overwhelmingly common case for this journey,
since most gatherings on Discover aren't the browsing user's own — never sees a "Plan" CTA on that
screen at all once joined; only "Invite Friends" (`:506`, notification-reason banner only, not
always present). This isn't a broken hop or a fabricated screen, so it doesn't fail the "no
gratuitous intermediate screen" criterion literally — but the *journey itself* (discover an
activity → plan) is only fully walkable when the discovered activity happens to be one's own
hosted gathering. A genuinely non-host attendee can still separately reach `AskBusinessScreen`
on their own (Item 53's plan-first flow, or Home/Discover's own general ask entry points) — just
not from this specific gathering screen with the gathering's own context pre-filled. Not fixed
this session: building an attendee-facing personal "plan something around this" CTA distinct from
the host's group-level one is a real, disclosed feature decision (whether/how to scope it, whether
it should even exist alongside "Invite Friends"), not a mechanical bugfix, and the standing
feature-freeze convention says not to start it without explicit direction.

## Journey D — Create

Traced `DiscoverHubScreen.js`'s search-empty-state escape hatch → `createAssistant.js`'s
classification/routing → `CreateGatheringScreen.js`/`CreateCommunityScreen.js` submit handlers →
post-publish screens. **Verdict: clean, no dead end** — full chain re-verified against the real
code (not just re-trusted from the CLAUDE.md history summary of items 26/37).

Key confirmations: the "Create What You're Looking For →" CTA is gated on the same live
`filteredGatherings`/`filteredCommunities`/`filteredOffers` state the visible empty-state text
itself uses (`DiscoverHubScreen.js:941-942`), so it can never show alongside real results and never
goes stale. `handleCreateItFromSearch()` (`:1008-1019`) reads the same `searchQuery` state, calls
`classifyCreateRequest()`, and surfaces any error via `Alert.alert` rather than swallowing it.
`routeClassifiedIntentToCreation()` (`createAssistant.js:64-74`) routes gathering/community/
business-partner intents to their real screens with matching param names on both ends
(`quickStartTitle`/`quickStartCategory` written and read identically); critically, an `unclear`
classification still lands on `CreateGathering` with the user's own raw typed text as the title —
the fallback-of-a-fallback that guarantees the search term is never dropped even when the AI can't
classify it at all. Both `CreateGatheringScreen.js` and `CreateCommunityScreen.js` submit handlers
validate visibly (`Alert.alert` on rejection/moderation/blank-required-field), call a real Supabase
insert, catch and surface errors (never swallowed), and on success `navigation.replace()` into a
real next screen with correctly-matching param names — `GatheringConfirmationScreen` (real Share/
Invite/Done actions, plus its own error-fallback escape hatch) and `CommunityDetail` respectively.
No unregistered route, no param-name mismatch, no unwired submit button found anywhere in the
chain. Not exercised in a running app (no simulator/device tooling this session, standing note) —
this is a full code trace.

## Journey E — Business

Traced both directions: (1) an ask-box intent resolving to a specific real `business_availability`
posting, picked directly; (2) a general fan-out where a business responds on its own. **Verdict:
fully connected — every hop threads a real ID or status transition into the next, no broken
link.**

Direction 1: `intentResolver.js`'s `resolveBusinessAvailability()` queries real live postings via
`search_active_business_availability()`, carrying the real `availabilityId` onto each candidate.
Tapping one navigates to `AskBusiness` with `matchedAvailability`; submitting threads
`preferredAvailabilityId` through `submitBusinessRequest()` → `create_business_request()` →
`_match_request_to_availability()`, which inserts a `business_request_offers` row already at
`status='offered'` (confirmed against the live migration body) — `BusinessRequestDetailScreen.js`
correctly renders this as "Made you an offer" with a real Accept button, not stuck on the parent
request's own "waiting" copy. Direction 2: `_business_request_fanout()` inserts one `pending` offer
per eligible business; a business's own dashboard flips it via `submit_business_offer` to
`offered` — rendered identically to direction 1 on the same detail screen. Accepting either calls
`accept_business_offer()`, which genuinely writes a `business_reservations` row (`status='confirmed'`)
and a `business_payments` row, and sets `business_requests.status='fulfilled'`. A DB trigger
(`sync_plan_status_from_business_request()`) then promotes the matching `plans` row to
`status='confirmed'`, which `getMyStandaloneBusinessRequestPlans()`/`PlansScreen.js` already
surface as a real, tappable Plan (Item 52) — closing the loop back to a Plans-tab row. Both
`STATUS_COPY` (5 request statuses) and `OFFER_STATUS_COPY` (8 offer statuses) were checked against
their DB CHECK constraints — full coverage, no unhandled value falling through to nothing. No
unwired accept/decline/cancel action found.

**One real, small, currently-dormant gap found and fixed**: `plans.status`'s own CHECK constraint
(`20260914_plans_unified_object.sql`) allows `'completed'`, but `resolvePlanTableStatus()`
(`src/constants/planStatus.js`) only explicitly mapped `confirmed`/`cancelled`, defaulting
everything else — including a hypothetical `completed` row — to `PENDING`. Verified live against
production that no trigger anywhere in the schema currently writes `'completed'` to this column
(grepped every `update ... plans set status`), so this has never mismapped a real row — but it
would have silently mislabeled a completed business-request plan as "Pending" the moment any
future trigger starts setting it. Fixed with one explicit `if (rawStatus === 'completed') return
PLAN_STATUS.COMPLETED;` branch + a new Jest test. Full suite 296/296 passing; both touched files
(`planStatus.js`, `planStatus.test.js`) transform-checked clean. Not exercised in a running app (no
simulator/device tooling this session, standing note) — this is a full code trace plus one
pure-function fix, no live DB write was needed since nothing currently produces the value being
fixed for.

## Item 59 — overall verdict, all 5 journeys

All five journeys were traced end-to-end against the real current code (not re-trusted from
memory) and, with the fixes made across this multi-session effort, all five now hold up against
their own acceptance criterion:

- **A (Dating)** — clean, one disclosed-not-fixed friction point (Plan Together buried at #12/12
  in a generic menu instead of a direct hop to DateProposalScreen — a design call, not a bug).
- **B (Friends)** — clean after fixing 4 real bugs this session (friend-plan mislabeling on Plans
  tab; 3 leaked dating/relationship-tool exposures in Chat's Together menu and safety check-in).
- **C (Discover)** — clean on the literal "no unnecessary intermediate screen" criterion (2 real
  pushes, 2 in-place expansions); one disclosed-not-fixed reachability gap (the gathering Plan CTA
  is host-only, so a non-host discovering someone else's gathering can't reach it from that screen).
- **D (Create)** — clean, no changes needed; full re-verification of items 26/37's prior escape-
  hatch work held up exactly as documented.
- **E (Business)** — clean/fully connected; one small dormant status-mapping gap found and fixed.

Net this session: **6 real bugs found and fixed** (friend-plan mislabeling + DB trigger; 3 dating-
language leaks in Chat; 1 dormant plan-status gap — plus PlansScreen's client render), all verified
(Jest + babel transform, live disposable DB checks where a migration was involved) and committed.
**2 real gaps disclosed but deliberately not built** (Plan Together's menu placement; the host-only
gathering Plan CTA) — both are product-scope decisions under the feature-freeze convention, not
mechanical fixes, flagged here for explicit direction rather than assumed. Nothing exercised in a
running app this session (no simulator/device tooling available, standing note across this whole
project) — every finding above is a full code trace, not an on-device observation.
