# Nearby — Project Instructions

Nearby is a proximity-based dating/social discovery app (React Native/Expo, Supabase backend).
Supabase project ref: `enmosvippabmuqslzrox`. A Management API access token lives in
`.claude/mcp.json` (gitignored) — used via direct `curl` against
`https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query` for schema
inspection/migration application, since the Supabase MCP server itself has not been reliably
available via ToolSearch in past sessions.

## Read this first — why this file looks different now (2026-09-17)

This file used to grow without bound: every session appended its full build log, verification
trail, and reasoning to the end, forever. By 2026-09-17 it had reached **29,860 lines / 2.46MB**
— reloaded in full at the start of every session as project instructions. Two sessions in a row
spent their entire budget on compaction of that giant file and made no forward progress on the
actual work (Phases 4-6 of the "Business Web as an Operating System" plan, since closed out —
see `CLAUDE_HISTORY.md`).

**The fix**: the complete, unedited historical record — every past session's full build log,
every audit, every locked design decision with its full original reasoning and verification
detail — was moved byte-for-byte to **`CLAUDE_HISTORY.md`**. Nothing was deleted or summarized
away; it's just not auto-loaded every session anymore. This file (`CLAUDE.md`) now holds only:
standing conventions that remain in force, and whatever's currently active/unfinished.

**When to open `CLAUDE_HISTORY.md`**: only when you genuinely need the detailed reasoning or
live-verification trail behind why some already-shipped feature works the way it does, or a full
account of a specific past session someone asks about by date. It's organized reverse-
chronologically (most recent work first) with clear dated section headers — grep for a date or
feature name rather than reading start to end. For everyday work, including picking up the
active items below, this file should be enough. Don't open the history file "just in case" —
that's exactly the habit that caused the problem this split exists to fix.

**Standing rule going forward, so this doesn't happen again**: keep this file short — a few
hundred lines, not tens of thousands. When a plan/phase finishes: (1) append the full verbose
build/verification account to the *top* of `CLAUDE_HISTORY.md` (most-recent-first), (2) replace
whatever was in this file's "Active / unfinished work" section for that plan with either nothing
(if fully done) or a short status line, (3) fold any newly-locked standing convention into the
"Standing Conventions" section below as a single bullet, not a narrative. Do not let this file
grow past a few hundred lines without doing this split again.

## Active / unfinished work

**Item 60 ("the CEO test," first-time-user obviousness) — fully DONE (2026-09-12).** All 5
questions (What is Nearby? / What can I do here? / How do I find something? / How do I meet/
connect with someone? / How do I actually make something happen?) PASS — each answer is obvious
from real on-screen copy/navigation with no chained explanation needed, per a full code trace of
the signed-out onboarding flow, Home, Discover's mode toggles, and the primary CTAs on Gathering/
Profile/Business detail screens. Two small, real first-impression soft spots found and fixed (both
copy-only, no navigation change): Home's rotating ask-box placeholders were 100% activity-shaped
with no hint that meeting people is also part of the app (added "Meet new people…," a real,
already-supported intent phrase); the Quick Stats "N people nearby" row read as a passive stat
rather than an action (reworded to "N people nearby to meet"). Full detail:
`PRODUCT_AUDIT/CEO_TEST_2026-09-12.md`.

**Item 59 ("the Thursday acceptance test," 5 end-to-end journeys) — fully DONE (2026-09-12).** All
5 journeys traced and verified against real current code; 6 real bugs found and fixed (friend-plan
mislabeling, 3 dating-language leaks in Chat, 1 dormant `plans.status` mapping gap), 2 real
scope-decision gaps disclosed but not built (Plan Together's menu placement; the host-only
gathering Plan CTA). Full detail: `CLAUDE_HISTORY.md`, search "Item 59"; per-journey trace detail:
`PRODUCT_AUDIT/THURSDAY_ACCEPTANCE_TEST_2026-09-12.md`.

**Item 57 ("the N mark should become part of the product language") — fully DONE (2026-09-12).**
User's own framing: use the redesigned N mark consistently beyond the app icon (loading, empty
states, "perhaps" success confirmation, subtle brand transitions, notification identity) but
"don't overdo it — the goal is for the N to become recognizable, not become decoration
everywhere." A research fork first confirmed real infrastructure already existed: a real,
approved SVG brand component (`src/components/brand/NearbyMark.js`, variants gradient/white/
black, "works on any background per the approved brand sheet" per its own header comment) already
used on Login/Onboarding/BusinessWeb, plus `BrandedLoader.js` already using the same mark (as a
raster PNG) at `RootNavigator.js`'s boot gate. **Loading and notification identity were both
already fully shipped** before this item — `BrandedLoader`'s gate (`loading ||
(session && profileLoading)`) already catches the sign-in transition too since `profileLoading`
flips true immediately on a fresh sign-in, and `app.json`'s `notification-icon.png` +
`color: '#FF5A5F'` (Android status-bar icon, confirmed still current) already gives every push its
own brand identity — no code needed for either. The three real remaining bullets were each
deliberately scoped to a small, concrete set of genuine moments rather than a blanket retrofit:
- **Empty states**: `NearbyMark` (small, muted/low-opacity) added to `LoadErrorState.js` — the
  one shared "couldn't load" component reused broadly across the app, so this single change
  reaches every screen that already uses it, rather than a per-screen retrofit. Also added to the
  3 real self-contained empty-state *blocks* (not the many inline single-line empty texts buried
  inside dense multi-section screens like `CommunityDetailScreen`/`GroupPlanScreen` — deliberately
  skipped those, since adding an icon to inline text mid-scroll would tip toward clutter, not
  identity): `BusinessRequestDetailScreen.js` ("no businesses responded yet"),
  `MomentumScreen.js` (empty weekly chart), `MakeAPlanScreen.js` ("no friends yet") — all three
  already gained real next-action CTAs in Item 56, which is what makes them genuine, deliberate
  empty-state moments rather than throwaway text.
- **Success confirmation** (the user's own softest ask — "perhaps"): `GatheringConfirmationScreen.js`,
  the app's one real, already-existing celebration screen, gained a small spring-in `NearbyMark`
  above its existing 🎉 emoji (same `Animated.spring`/`timing` entrance shape
  `MatchCelebrationModal.js` already established for a celebration moment) — an addition, not a
  replacement for the emoji's own fun/expressive energy. Deliberately did NOT build new success UI
  for community creation, business-offer-accept, or group-plan-confirm — all four currently have
  *no* dedicated success UI at all (confirmed by the research fork: community creation is a bare
  `Alert.alert`, the other two are silent state re-renders) — building 4 new celebration surfaces
  from scratch is a bigger scope decision than "extend an existing mark," and risks exactly the
  "decoration everywhere" the request warned against. Flagged as a real, disclosed, not-built
  opportunity rather than assumed out of scope.
- **Subtle brand transitions**: `RootNavigator.js`'s sign-out and onboarding-complete flips (both
  instant `Stack.Navigator` children swaps with zero transition before this — confirmed by the
  research fork, not assumed) now show one brief (450ms) `BrandedLoader` beat — reusing the
  existing component, not a new one — triggered by real state-change detection
  (`prevSessionRef`/`prevProfileCompleteRef` comparing against the previous render, never firing
  on initial mount).

Full Jest suite 295/295 passing; all six touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — next session should confirm the 450ms transition beat feels right in practice
(picked as a reasonable estimate, not measured against a real device) and that the empty-state
mark's muted opacity reads as "quiet identity" rather than "washed-out icon" on a real screen.

**Item 56 ("no dead ends") — fully DONE (2026-09-12).** Direct product requirement, locked as a
standing convention (see below): no major surface should end with unactionable "nothing here"
copy — always a concrete, tappable next step (Demand → supply → activity → engagement, in the
user's own words). Items 25/26 (2026-09-11) already did a big pass on this exact problem; this
item re-audited the whole app (background fork) against that baseline, specifically to catch
surfaces built or changed in the items since (27-55). Found and fixed 4 real remaining gaps:
`PlansScreen.js` (all 3 tabs had a text-only empty state — now "+ Host a Gathering"/"Explore
Things To Do"), `MomentumScreen.js` (weekly chart empty state, now "Explore Things To Do"),
`BusinessRequestDetailScreen.js` ("Try a Wider Radius" only ever rendered once, right after
submitting with `notifiedCount === 0` — now renders whenever the request is still open with zero
offers, and its prefill fields fall back to the real fetched request row's own columns when
route.params carry none, e.g. a revisit via push tap), `MakeAPlanScreen.js` ("no friends yet" had
no way to actually go add one — now links to `FriendDiscovery`). One low-priority candidate
(`RecommendationCustomizePanel.js`'s "add interests" copy) was initially left unfixed — no real
existing route anchored directly to the interest editor (an inline `ProfileScreen` section, not
its own screen) — **closed same day, per direct user request ("do the one low priority case"):**
rather than guess a destination, built a real scroll-anchor the same way this app already solves
"land on the right part of an existing screen" elsewhere (`scrollToGenderSection`/
`scrollToPreferences`) — a new `scrollToInterestsSection` route param on `ProfileScreen.js`
(`interestsSectionYRef` + `onLayout` + a route-param `useEffect`, identical shape to those two
precedents) scrolls straight to the real interest picker; `RecommendationCustomizePanel.js` gained
an `onPressAddInterests` prop, wired from both `SettingsScreen.js` call sites to
`navigation.navigate('Profile', { scrollToInterestsSection: true })`. Full Jest suite 295/295
passing; all three touched files transform-checked clean. Not exercised in a running app (no
simulator/device tooling this session, standing note) — next session should confirm the scroll
lands on the interests section specifically. Commit: `d7998ce0`. Full audit also confirmed a long
list of surfaces already correct from the Items 25/26 baseline (`DiscoveryScreen`/
`FriendDiscoveryScreen`/`MatchesScreen`/`FriendsScreen`/`CommunitiesScreen`/`GatheringsScreen`/
`DiscoverHubScreen`/`PlacesScreen`/`BusinessDashboardScreen`/`ChatScreen`/`RewardsScreen`/
`OccasionsScreen`/`CommunityDetailScreen`/`AskBusinessScreen`/`SurpriseMeSheet`/`ProfileScreen`),
plus 2 genuinely passive/analytics states in `GroupPlanScreen.js` correctly left honest (no
obvious retry destination exists for those, same precedent Item 25 batch 4 already set for
BusinessDashboard's own passive states). Full Jest suite 295/295 passing; all five touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note).

**Item 55 ("deep links should preserve context too") — fully DONE (2026-09-12).** A notification
tap used to dump the user onto a bare `GatheringDetail` with zero explanation of why they were
there — e.g. `notify_gathering_interest()` (a host learns someone's interested in their own
gathering) and `notify_gathering_interest_threshold()` (a stranger learns real nearby interest
matches their own tastes, `recommended_gathering`) both already compute a real, specific reason
sentence for the push body, but `routeNotificationTap()` only ever forwarded `gathering_id` —
the reason itself was read once, then thrown away.

Fixed by carrying the push's own real body text through as a route param, rather than inventing
new copy: `notifications.js`'s two `Notifications.*` listener call sites now merge the
notification's top-level `body` onto its `data` payload (`contentWithBody()`) before routing, and
the `gathering_interest`/`recommended_gathering` cases pass `notificationReason` (the literal real
sentence the user already read) through to `GatheringDetail` — plus `notificationSuggestsInvite:
true`, since those two are the only gathering-notification types where "Invite Friends" is
genuinely the one obviously-correct next step (capitalizing on real momentum). Every other
gathering-shaped push type (invite/reminder/waitlisted/updated/recurring) now also carries
`notificationReason` for its own real reason banner, but deliberately without the invite CTA —
there's no single obviously-correct action to force for those, and forcing one anyway would
violate the same "don't notify about things you can't act on" discipline Items 48/49 already
established for the push itself. `GatheringDetailScreen.js` renders a dismissible banner at the
very top of its content (before the title) showing that real reason text, with an inline "🤝
Invite Friends" button (reusing the exact same `InviteFriendsModal`/`setInviteModalVisible` every
other Invite link on this screen already uses — confirmed generic over host/attendee/not-yet-
joined callers alike, so it's safe for the `recommended_gathering` case where the recipient hasn't
joined yet) when `notificationSuggestsInvite` is set. Not built as a new "Plan" step beyond
View→Invite: for a gathering specifically, the gathering itself already *is* the plan — there's no
honest third stage to add without fabricating one.

Scoped to gathering-shaped notifications only, matching the user's own example exactly — the same
"real reason + obvious action" banner mechanism is a real fast-follow candidate for other detail
screens reached by notification (`BusinessRequestDetail`, `CommunityDetail`, etc.) but wasn't
built for those now; flagged here rather than assumed. Full Jest suite 295/295 passing (no new
pure functions to test — pure UI/routing wiring over already-computed, already-live push text);
both touched files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app or against a real push notification (no simulator/device tooling this session,
standing note) — next session should confirm on a real device that a tapped `gathering_interest`/
`recommended_gathering` push shows the correct real reason text and that "Invite Friends" opens
the existing modal correctly from that banner.

**Item 55 fast-follow #1 (`BusinessRequestDetail`) — fully DONE, same day (2026-09-12).** Picked
up in-flight, uncommitted work interrupted by a codespace restart mid-session, then finished and
committed (`155ef16d`). Closes the first of the two concrete candidates the paragraph above
flagged as not-yet-built: a `business_offer_received`/`business_offer_withdrawn`/
`business_reservation_cancelled` notification tap now carries the push's own real body text
through as `notificationReason` (`notifications.js`, same `data.body ?? null` shape the gathering
cases already use), rendered by `BusinessRequestDetailScreen.js` as the same dismissible banner
at the very top of its content, styled identically to `GatheringDetailScreen`'s own version
(`colors.primaryMuted` fill, `colors.primary` border). Deliberately no forced CTA in this banner
(unlike the gathering `notificationSuggestsInvite` case) — the offer list rendered right below is
already the obviously-correct next thing to look at, so a second competing button would just be
noise; documented inline in the screen's own comment at the fix site. `CommunityDetail` (the
paragraph's other named candidate — `business_partnership_response`/`community_area_demand_growing`
taps, both of which currently navigate there with no reason at all) remains a real, un-started
fast-follow, not assumed done by this change. Full Jest suite 295/295 passing (no new pure
functions — same UI/routing-wiring shape as the original Item 55); both touched files transform-
checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app or against a
real push notification (no simulator/device tooling this session, standing note).

**Item 55 fast-follow #2 (`CommunityDetail`) — fully DONE, same day (2026-09-12).** Closes the
last remaining candidate the original Item 55 paragraph named, per direct user request ("do
community detail too"). `business_partnership_response` (community-target branch) and
`community_area_demand_growing` notification taps now carry `notificationReason` through to
`CommunityDetailScreen.js`, which renders the exact same dismissible banner
`BusinessRequestDetailScreen` already has (same styles, no forced CTA — the community's own
content below is already the obvious next thing to look at). Bundled in the same change:
`business_partnership_response`'s gathering-target branch also now passes `notificationReason` —
`GatheringDetailScreen` already fully supports the param generically (no CTA renders, since
`notificationSuggestsInvite` isn't set for this type), so this closed the same real gap for that
branch with no new code needed there. With this, every notification type this app sends that
routes to `GatheringDetail`, `BusinessRequestDetail`, or `CommunityDetail` now carries its real
reason text — the fast-follow list from the original Item 55 paragraph is fully closed out; no
further named candidates remain. Full Jest suite 295/295 passing; both touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app or
against a real push notification (no simulator/device tooling this session, standing note).
Commit: `8c37cc6e`.

**Item 54 ("the app should remember context on back navigation") — audited, already TRUE by
construction, no code change needed (2026-09-12).** Both named examples ("Things To Do → Today →
Fitness → open an event → back" and "People → Friends → filters → open a profile → back") traced
through the real navigation tree rather than assumed: `RootNavigator.js` registers `MainTabs` (the
`Tab.Navigator` holding Home/Discover/Create/Activity as plain `Tab.Screen`s, no nested per-tab
stacks, no `unmountOnBlur` anywhere) as one `Stack.Screen` sibling alongside `GatheringDetail`/
`ViewProfile`/every other detail screen in the single outer `Stack.Navigator`. Navigating to a
detail screen pushes it on top of that outer stack — `MainTabs`, and everything inside it, stays
mounted underneath (React Navigation's own default); popping back returns to the exact same
mounted instance with all local `useState` intact, no extra plumbing required.

Verified this actually holds for both examples by reading the real state, not just the general
mechanism: `DiscoverHubScreen.js`'s `mode`/`peopleSubMode`/`expandedContext` are all plain
`useState`, and the one `useEffect` that seeds `mode`/`peopleSubMode` from `AsyncStorage` runs only
on initial mount (`[]` deps) — it does not re-run on refocus, so it can't stomp on a value the
user already changed. The screen's own `useFocusEffect` only re-fetches gatherings/communities/
offers/businesses on refocus; it never touches `expandedContext`. People/Friends mode renders
`FriendDiscoveryScreen` as a directly-embedded child component (not a separate navigated screen,
per the Aug 24 2026 "embedded" pattern) — its own filter state (`interestFilters`/`distanceFilter`/
`verifiedOnlyFilter`/`onlineOnlyFilter`/quick-filter order) is likewise plain `useState`, and its
own `useFocusEffect` only reloads candidates, never resets a filter.

Not exercised in a running app (no simulator/device tooling this session, standing note) — next
session should still confirm this visually once tooling is available, since this conclusion is
from a full code trace, not an on-device observation.

**Item 53 ("The business relationship should attach to the Plan") — fully DONE (2026-09-12).**
Direct continuation of Item 52: "Allen + Claude + Dinner + Friday 7PM" should become a Plan, and
Nearby should then find real restaurant options for it — not force the user to wait on an
asynchronous "ask and hope a business responds" cycle before seeing anything real. Given a
direct user pick (via `AskUserQuestion`, among "build the plan-first flow now" / "hold, the data
model already satisfies it" / "small enrichment only"): **build the plan-first flow.**

Real finding before writing any code: the entire backend chain the user described — Plan →
location → business → availability → offer → reservation — **already existed end to end**,
verified live: `plans.resulting_business_request_id` → `business_request_offers` →
`business_reservations`, plus `submitBusinessRequest()`'s existing `preferredAvailabilityId` param
(Intent Layer UX walkthrough finding 5) already binds a request directly to one specific,
already-live `business_availability` posting — confirmed by reading `_match_request_to_availability()`
live: passing a preferred posting immediately inserts a real `business_request_offers` row at
`status = 'offered'`, no waiting on the business at all. The only genuinely missing piece was a
**client-side "search live options first" step for the general (non-match) ask** — that pattern
already existed for the dating-specific case (`DateProposalScreen`'s `handleFindNearby`/
`handleChooseNearby`, external UX critique reply item 4) but had never been generalized to the
plain solo "ask a business" flow.

Shipped by enhancing `AskBusinessScreen.js` (solo mode only — a gathering/community already
sources location server-side, and a match's own pre-accept search already lives on
`DateProposalScreen`) rather than building a duplicate new screen: a new "🔎 Find options nearby"
step, placed right after party size/budget so a real `partySize` is available to filter capacity,
calls the existing `searchActiveBusinessAvailability()` with real device location; picking a
result sets `pickedAvailability` and is threaded into the existing `preferredAvailabilityId` param
on submit (composes the "what do you want?" text field from the real chosen business, but only
when the caller hadn't already typed their own text). No new DB migration, RPC, or schema — every
moving part reused verbatim. The "who" half of the example ("+ Claude") also needed no new code:
`BusinessRequestDetailScreen.js` already has a real "👤 Invite Someone" panel (Item 36 chain 1)
that appears the moment the resulting request lands, open and not yet part of a group plan —
exactly where the plan-first flow's own submit navigates to.

Full Jest suite 295/295 passing (no test files needed changes — no new pure functions introduced,
only UI wiring over already-tested services); `AskBusinessScreen.js` transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that "Find options
nearby" returns real results, that picking one correctly shows as an already-"offered" business on
`BusinessRequestDetail` immediately after submit, and that "Invite Someone" still works right
after a plan-first submission.

**Item 52 ("Build a universal Plan object") — first real increment shipped (2026-09-12).**
The `plans` table (Phase G, `20260914_plans_unified_object.sql`) has existed since Sep 14 2026,
populated additively by triggers on gatherings/business_requests/date_proposals, but had zero
client readers until now (re-confirmed by Item 51's own migration comment the same day: "no
`.from('plans')` call exists anywhere in src/"). Given a locked scope decision via a direct user
message relaying their own advisor's reasoning — **"wire the client first" (Option 1)**: prove
the existing `plans` object can drive real UI before investing in completing its data model
(participants, business/place association, more trigger sources) or building a dedicated new
Plans screen. Explicit caveats given alongside: don't leave underlying Plan states inconsistent
(the existing lifecycle rules still apply), and don't add speculative schema complexity in this
pass.

Shipped: `src/services/plans.js` (`getMyStandaloneBusinessRequestPlans()`,
`getMyDateProposalPlans()`), both first real reads of the `plans` table — reused the existing
`PlansScreen.js` ("Your Plans," already the app's "complete commitment calendar" surface) rather
than a new navigation destination, per the caveat. Scoped to exactly the two `plan_type`s that
screen had **zero visibility into before this** — a solo business request (asked but never
merged into a Group Plan) and a dating date proposal — both now render as real `PlanCard` rows on
the Upcoming tab, same treatment Group Plans already got (no scheduled-slot sort, own unsorted
block, never split into Past — matching `getMyGroupPlans()`'s own existing precedent). New
`resolvePlanTableStatus()` (`constants/planStatus.js`, 3 new Jest tests) maps the table's own
already-collapsed `draft`/`confirmed`/`cancelled` status onto the existing six-word `PLAN_STATUS`
vocabulary used everywhere else on this screen.

Deliberately did NOT touch gathering-sourced plans (still read via the existing
`getMyAttendingGatherings()`/`getMyGatherings()` queries) — a gathering someone else hosts has no
`plans` row at all (RLS is `created_by`-only, no participant concept on this table yet), and
building one now would be exactly the speculative schema complexity the locked decision said to
defer. Also did not touch the already-shipped Group Plans list; standalone business-request plans
are explicitly de-duplicated against it client-side (excluded whenever the underlying
`business_requests.group_plan_id` is set — a real, disclosed gap in the original Phase G
migration is that this isn't synced onto `plans.status`, so it has to be checked directly).

Verified live against production (`enmosvippabmuqslzrox`) via two disposable rolled-back
transactions (real FK constraint names for `resulting_business_request_id`/
`resulting_date_proposal_id` confirmed first via `pg_constraint`; a solo open request, a
group-plan-merged request, and a cancelled request inserted, and the filtering logic — the
merged one is present at the SQL level but excluded by the client-side filter, the cancelled one
is excluded already by `status <> 'cancelled'`, the solo one is present — was confirmed correct
in both directions; a real date-proposal row correctly produced a `dating_date` plan row with the
right `match_id` for navigation), plus a live, unauthenticated REST call against the actual
PostgREST endpoint with the exact embed-join query strings the client uses, confirming they parse
correctly (rejected on `anon`'s missing table grant — the expected/correct outcome — never on a
malformed embed). Both disposable transactions rolled back and re-confirmed zero leaked rows.
Full Jest suite 295/295 passing; all four touched/new files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note) — next session should confirm on a real account that a genuine solo
business request and a genuine date proposal each render correctly as a Plans-tab row and that
tapping each lands on the right existing screen.

Real next increments, not started, no code exists for them yet (flagged, not assumed): the
gathering-attendee/participant gap named above; folding `plans` into other existing ad-hoc
surfaces (e.g. `getMyBusinessEcosystemActivity()` on ActivityScreen still queries
`business_requests` directly rather than `plans`); a `birthday`/`anniversary`-sourced plan row
(no trigger populates these plan_types yet, a real disclosed gap from the original Phase G
migration, unrelated to this pass).

**Item 51 ("cancellation needs to propagate everywhere") — fully DONE (2026-09-12).** Cancelling a
Gathering or Community used to be a partial state change: an already-ACCEPTED business offer
(a confirmed reservation, possibly a captured payment) tied to it survived untouched. Fixed by
extracting Item 50 fix 5's cancellation logic into a shared `_cancel_reservation_by_offer()`
helper that `cancel_gathering()`/`cancel_community()` now also call for any accepted offer,
preserving the same real-money-safety rule (captured/authorized payments block auto-cancellation,
both sides notified to coordinate directly). Every other concern the user listed (attendee
notification, dead deep links, recommendation surfaces, stale promotion) was checked live and
found already correct — no fix needed. One client gap closed: `CommunityDetailScreen.js` no
longer offers "Invite Friends"/"Host a Gathering" on a cancelled community. Verified live via 4
disposable rolled-back scenarios against the real deployed functions. Full detail:
`CLAUDE_HISTORY.md`, search "Item 51".

**Items 48 & 49 ("notifications need a reason + action" / "don't notify about things you can't
act on") — fully DONE (2026-09-11).** Picked up in-flight, uncommitted work from an interrupted
prior session: `get_business_availability_by_id()` (`supabase/migrations/
20261010_business_availability_by_id.sql`) was already written AND already applied live in
production, but never wired into the client — this was the single biggest violation. A background
audit fork then surveyed all 59 live push-sending Postgres functions in production against both
rules, cross-referenced against `notifications.js`'s `routeNotificationTap()` switch (full report:
`PRODUCT_AUDIT/NOTIFICATION_REASON_ACTION_AUDIT_2026-09-11.md`). Found and fixed 6 concrete gaps,
all now shipped: (1) `recommended_business_availability` taps now fetch the specific matched
posting via the new RPC and land on `AskBusinessScreen` pre-filled with it (`matchedAvailability`,
same shape `intentResolver.js` already builds), falling back to the generic Discover tab only when
the slot's genuinely gone (expired/inactive) by the time it's tapped; (2)
`notify_gathering_interest`'s push now includes `gathering_id` in its payload (was already
computed, just never passed through) so a host's tap lands on the specific gathering instead of a
generic browse; (3) `submit_social_offer()`/`respond_to_social_offer()` now resolve and include the
real `group_plan_proposals.id` via `resulting_request_id` (a social offer's only real
consumer-facing surface is `GroupPlanScreen`, keyed by `proposalId`) — a request created outside
the group-plan flow honestly yields no `proposal_id`, no fabricated destination; (4-6) added
tap-routing cases for four notification types that previously had **none at all** (tap did
literally nothing): `community_cancelled` (→ Communities browse, same "row's gone" shape as its
`gathering_cancelled` sibling), `business_offer_withdrawn` (→ `BusinessRequestDetail`, same
destination as its `business_offer_received` sibling), `date_proposal`/`date_proposal_response`
(→ `DateProposalScreen`, already keyed by the `match_id` both payloads already carried). Everything
else surveyed (the large majority) was already correctly reason-bearing and actionable — no changes
needed there; full function-by-function table in the audit report. Migration
(`20261011_notification_reason_action_fixes.sql`) verified live via disposable rolled-back
transactions (confirmed `gathering_id` now flows into the queued push payload; confirmed the
`proposal_id` lookup resolves correctly for a request with a real originating group plan) before
being treated as done; `get_business_availability_by_id()` itself was separately verified live the
same way (an active posting returns full data, an expired one honestly returns nothing). Full Jest
suite 292/292 passing throughout; all touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note) — push notifications specifically can't be end-to-end verified without a real
device token. Commits: `760c0fef`, `d72a189c`.

**Item 50 ("state consistency audit") — fully DONE (2026-09-12).** All 6 findings shipped: fixes
1/2/3/4/6 (2026-09-11) plus fix 5, "cancel a confirmed reservation"
(`cancel_business_reservation()` RPC + client wiring in `BusinessRequestDetailScreen.js`/
`BusinessDashboardScreen.js`), resolved after a resumed session traced the prior "reproducible
PL/pgSQL anomaly" to a mundane cause — a CHECK constraint that hadn't been widened yet in the
same still-unapplied migration, not an engine bug. Full detail: `CLAUDE_HISTORY.md`, search
"Item 50 ... fix 5".

**Items 46 & 47 ("personalization should determine what appears first" / "don't
over-personalize too early") — first real increment shipped (2026-09-11).** Paired ask: Discover
should genuinely reorder itself around a real, earned behavioral signal ("someone who constantly
searches fitness should see Fitness near you"), but must never fabricate personalization for a
user with no real history yet (explicit cold-start fallback list given: Popular nearby/Happening
today/Friends are interested/Based on your selected interests). Built on top of the "10/10
roadmap" Part 7 infrastructure already in place (`intent_submissions`, RLS-scoped to each user's
own rows) rather than inventing new instrumentation, per the user's own "the architecture you've
been building makes this possible."

Shipped: a new pure `findTopSearchedCategory()` (`src/utils/intentPatterns.js`) — a broader
sibling of the existing day/time-scoped `findRecurringIntentPattern()` (used for Home's smart
placeholder): counts a caller's own real `intent_submissions.category` history with no day/time
constraint, returns the top category at 3+ real occurrences (same `MIN_OCCURRENCES` floor, same
"null means honestly unknown" discipline), or `null` for anyone who doesn't qualify yet. Wrapped
by `getMyTopSearchedCategory()` (`src/services/intentOutcomes.js`, same query shape as the
existing `getMyIntentPatterns()`). Wired into `DiscoverHubScreen.js`: when a real qualifying
category exists AND real matching gatherings genuinely exist nearby, a "{Category} Near You"
section renders **first** — ahead of Happening Now/Today/This Weekend/Categories — with a "See
all →" reusing the exact same single-`interestTag` expand-in-place mechanism a single gathering
tile's own context already used (no new navigation surface). Its ids are excluded from every
section below it, extending the exclusion chain those sections already apply to each other, so
nothing repeats. For a cold-start user (no qualifying history), the section simply doesn't
render — the screen falls straight through to the exact same Happening Now/Today/This
Weekend/Categories hierarchy every user already sees (item 14), with no fabricated "we know what
you like." Audited item 47's own prescribed fallback list against what's already real and
present rather than inventing new sections for it: "Happening today" already exists verbatim as
the Today section; "Based on your selected interests" and "Friends are interested" are already
real, itemized per-tile reasons every gathering tile surfaces via `getGatheringFitReasons()`
(`REASON_TEXT.MATCHES_INTERESTS`, `"N of your friends are attending"`) rather than needing to be
their own separate top-level sections; "Popular nearby" is effectively what the existing
fit-score-sorted tiers already surface. New Jest coverage (6 tests) for
`findTopSearchedCategory()`; full suite 286/286 passing; all three touched files transform-
checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no
simulator/device tooling this session, standing note) — this reads real per-user data
(`intent_submissions`), so behavior can't be confirmed against a live account this session.
**Follow-up, same day, per direct user request ("build that durable frequency signal... you
never finished earlier"): the deferred "mainly uses Friends" piece is now also DONE.** Shipped
real, durable, server-side usage-frequency tracking replacing the "last used" AsyncStorage-only
proxy as the sole signal. `20261009_people_submode_usage_tracking.sql` adds two plain counter
columns (`profiles.people_submode_dating_uses`/`people_submode_friends_uses`, same "counter
columns on profiles" pattern already used elsewhere in this schema) and a narrow, self-scoped
`record_people_submode_use(submode)` RPC (SECURITY DEFINER, `REVOKE ... FROM public, anon` per
this repo's own standing convention — verified live via `information_schema.role_routine_grants`
after a first attempt only revoked from `public` and left `anon` still granted, a real instance
of the exact gotcha that convention exists to catch). New pure
`resolveDefaultPeopleSubMode()` (`src/utils/peopleSubModePreference.js`, 6 Jest tests) only lets
the real usage counts override the remembered last-used value once there's a genuine, durable
skew (5+ combined real uses, not a tie) — below that threshold it defers to the exact same
last-used/default behavior as before, same "don't over-personalize too early" discipline as item
47. `DiscoverHubScreen.js`'s `selectPeopleSubMode()` now calls the new
`recordPeopleSubModeUse()` (`src/services/peopleSubModeUsage.js`) alongside its existing
AsyncStorage write; the mount effect now reads both the remembered value and the real counts
(`getMyPeopleSubModeUsage()`) in parallel and feeds both into the pure resolver. Verified live via
two disposable rolled-back transactions (a real counter-increment assertion, and an invalid-
submode rejection) before and after applying for real, plus a live grants check that caught and
fixed the `anon`-grant gap. Full Jest suite 292/292 passing; all three touched/new files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note) — this reads/writes real per-user data,
so behavior can't be confirmed against a live account this session.

**Item 44 ("give each screen ONE visual hero") — fully DONE (2026-09-11).** Direct continuation
of the "Things To Do feels busy" observation, reframed by the user as a visual-hierarchy problem
rather than a content problem: Discover's Things-mode header had title, subtitle, a full-width
two-box mode toggle, and a bordered search pill all competing at roughly the same visual weight
before any real content appeared. Per the user's own mock (Discover / "What are you looking
for?" / [search] / Things to Do | People / content), made the search bar the screen's one real
hero and demoted everything else around it, without reordering or removing any control (all
still fully functional, same conditional logic for breadcrumb/expandedContext untouched):
(1) Things mode's subtitle copy changed from the disconnected status line "What's happening
nearby." to a real lead-in question, "What are you looking for?", so title+subtitle+search now
reads as one intentional block instead of three separate elements. (2) The outer Things to Do |
People mode toggle (`modeToggleRow`/`modeToggleButton`) — previously two full-width, bordered,
filled boxes, the same visual weight class as the search bar and filter chips — is now a plain
auto-width text-tab treatment (thin colored underline on the active tab, no box or fill),
reading as clearly secondary navigation. Left the People sub-mode's own inner Dating|Friends
toggle (`peopleSubToggleRow`) untouched — it was already given a lighter treatment than the
outer toggle in the Aug 30 2026 fix, and that relationship still holds (arguably more clearly
now, since the two no longer share the same box-chrome family at all). (3) The search bar itself
(`searchBarWrap`/`searchInput`) got a modest bump in physical presence — taller input, slightly
bigger font, a touch heavier border, and the same `shadow.card` elevation this codebase already
uses to mark other "look here" surfaces — so it visually reads as the obvious place for the eye
to land. Filter chips/view toggle below it were left as-is; they were already a light chip row,
not part of the actual clutter. Full Jest suite 280/280 passing; `DiscoverHubScreen.js`
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app
(no simulator/device tooling this session, standing note) — this is a styling-weight change with
no layout/behavior change, but if anything reads visually off, this is the first place to check.

**Item 43 ("consider eliminating unnecessary section headers") — fully DONE (2026-09-11).**
Direct continuation of the "Things To Do feels busy" observation: a title on its own line,
content, then a separate "See all in X →" link on its own line below the content adds a full
extra row of visual weight per section, repeated across a whole screen it reads as a dashboard.
Fixed the concrete instance across Discover's Things-To-Do view (item 14's Today/This Weekend
sections, plus the Gatherings/Communities/Places/Perks browse-all sections) by merging each
section's title and its own "See all" onto one row (`sectionHeaderRow`/`sectionHeaderRowLabel`/
`seeAllInline`, new shared styles in `DiscoverHubScreen.js`) — "🌅 Today &nbsp; See all →" /
[content] / "🌴 This Weekend &nbsp; See all →" / [content], matching the user's own mock exactly.
Shortened each link's visible text to the generic "See all →" (the section's own header already
names what it's a see-all *of*; kept the more specific string in each `accessibilityLabel` for
screen readers). Sections with no "See all" at all (Happening Now, Categories, Recommended For
You, Happening Nearby) were already single-line headers with no description/button underneath —
untouched, already the lean shape the mock asks for. Removed the now-fully-dead `seeAll` style
(every call site converted). Full Jest suite 280/280 passing; `DiscoverHubScreen.js` transform-
checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no
simulator/device tooling this session, standing note).

**Item 42 ("Stories should reinforce People, not compete with it") — fully DONE (2026-09-11).**
Direct user principle: a story is a signal on a person, not its own separate discovery
hierarchy — "Allen 🔴 / Sarah 🔴 / Mike," never a "Stories" row sitting above a "People" row.
Item 8 (2026-09-10) already built this correctly for the People tab itself (Dating/Friends
swipe decks: the avatar carries the ring, tap the ring for the story, tap the card for the
profile — no separate Stories row there). This session found and closed the one remaining
violation: Discover's Things-To-Do "All" view still had its own separate "Public Stories Near
You" horizontal strip (`DiscoverHubScreen.js`) — a second Stories hierarchy, unattached to any
person list, browsing public-story posters generally (not just Dating/Friends candidates).
Per direct user pick (via `AskUserQuestion`): removed the strip entirely rather than relocating
that people-pool into the People tab (which the user explicitly rejected — folding it in would
just recreate the same "competing feeds" problem one level down, "People" becoming a collection
of different people-feeds). Public-story posters who are also real Dating/Friends candidates
still surface via the existing avatar-ring mechanism there; standalone public-story browsing via
the map (`getPublicStoriesOnMap`) is untouched — a genuinely different, non-hierarchy-competing
surface (a map, not a list). Removed alongside the JSX: the section's own state
(`publicStories`, `storyPhotoUrls`, `viewerTarget`), its loader (`loadPublicStories`), its
`StoryViewerModal` usage/import in this file (the component itself stays — still used by
`DiscoveryScreen.js`/`GatheringsScreen.js`/`FriendDiscoveryScreen.js`), its now-unused styles
(`storyRing`/`storyAvatar`/`storyAvatarPlaceholder`/`storyName`), and the now-fully-dead
`getPublicStoriesGrouped()` query function in `src/services/stories.js` (confirmed zero other
callers anywhere in `src/` before deleting). User's own broader framing, worth carrying forward
as a lens for future work: "don't create a separate surface for something that can be a signal
on an existing object" (story → ring on person; friendship → relationship state on person;
interest → attribute on person/activity; business availability → signal on business). Full Jest
suite 280/280 passing; both touched files transform-checked clean via `@babel/core` +
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note).

**Item 41 ("make 'People' about people, not dating") — audited, one real concrete gap closed
(2026-09-11).** User's ask: keep "People" as the parent label over Dating|Friends (explicitly likes
this architecture because it leaves room for more social-relationship types later without
restructuring) — but don't add anything new now, just make sure "People" doesn't silently mean
"Dating." Audited the app directly (not from memory) for exactly this conflation. The outer
architecture already matches what the user described, built in prior sessions: Discover's People
mode already has a real, visually co-equal Dating|Friends toggle (`DISCOVER_MODES`/
`PEOPLE_SUBMODES` in `DiscoverHubScreen.js`), a neutral 👥 icon (not a heart), and no other
top-level "People" label exists anywhere else in the app to fix. No restructuring needed or done —
Groups/Communities deliberately NOT added as sub-modes now, per the user's own explicit
instruction. Found one real, concrete violation: `HomeScreen.js`'s "Quick Stats" card showed "N
people nearby" (neutral icon, generic label) backed by a real count
(`dashboard.nearbyPeopleCount` ← `getNearbyMatches()` in `homeDashboard.js`) that's actually
dating-preference-filtered (show_me/age range/ethnicity/hair/eye color/interested_in_genders) —
tapping it routed straight to the standalone, dating-only `DiscoveryScreen` (`'Nearby'` stack
route) with no visible path to Friends at all. Fixed: gave `DiscoverHubScreen` an
`initialMode`/`initialPeopleSubMode` route param pair (an explicit navigation intent wins over the
remembered last-used mode for that one visit, falling back to AsyncStorage as before when absent)
and pointed the Quick Stats card at Discover's own real People > Dating|Friends toggle instead of
the walled-off legacy screen — same real Dating content pre-selected (the count itself is
unchanged, still accurate), but Friends is now one tap away rather than absent. No new query, no
relabeling of the count, no new screens. Full Jest suite 280/280 passing; both touched files
transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no
simulator/device tooling this session, standing note). Commit: `4161c6d0`.

**Item 40 ("categories should be the fallback, not the primary burden") — audited, one real
concrete gap closed (2026-09-11).** User's own stated hierarchy: intent/search first, categories
second, manual filtering third — categories still matter for discovery/SEO/business matching/
structured data, but shouldn't be the primary burden a consumer has to navigate. Audited every
consumer-facing discovery surface against this directly (not from memory): Home's ask box and
Discover's own search (item 39) already lead with intent; Discover's default Things-To-Do view
(item 14) already leads with Happening Now/Today/Weekend before its Categories row; Gatherings
already puts its search bar above its own collapsible filter accordion; Create leads with quick-
picks + free text ("Something Else"), never a forced category tree. `AskBusinessScreen`/
`BusinessPartnerApplyScreen`'s own required category fields are deliberately out of scope — those
are structured-data capture on a form the user already opened with clear intent, exactly the
"business matching, structured data" carve-out the item's own text names. `CommunitiesScreen.js`
has no category browsing at all to begin with (flagged separately, out of scope, by item 26's own
audit) — nothing to fix there for this item either. The one real, concrete violation found:
`PlacesScreen.js` (reached via Discover's "See all places" link) had 19 category chips as the
*only* way in, no search box at all, even though `searchNearbyPlaces()` already supports a keyword
param the parent Discover screen already uses. Fixed: added a real, debounced search box above the
chips. While actively searching, category stops acting as a hard type filter (Google's Nearby
Search ANDs type+keyword together, so a stale "Coffee" chip would silently zero out an unrelated
search) — mirrors Discover's own existing choice for its "All" tab keyword search. Tapping a
category chip while searching switches back to plain category-browse mode (clearing the search)
rather than combining into a confusing hybrid state. Empty-state copy, the loading caption, and the
item 26 "Ask Nearby Businesses" escape-hatch prefill all now reflect the real search text when one
was active. Full Jest suite 280/280 passing; `PlacesScreen.js` transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note). Commit: `87855fb0`.

**Item 39 ("search should understand the same language as the Intent Box") — fully DONE
(2026-09-11).** Connected to item 14. The real gap: Discover's unified search box only ever did a
literal ILIKE substring match over titles/descriptions/tags (`searchGatherings`/
`searchPublicCommunities`/`searchOffers`, plus item 26's own earlier taxonomy-aware tag matching)
— a genuine non-literal ask like "something fun with my girlfriend Saturday" has no title/tag it
could ever literally match, so it always fell straight through to "nothing matched anywhere" ->
Create It, never actually understood, unlike Home's own ask box. Shipped `runIntentSearch()`
(`src/services/intentResolver.js`) — composes the same `classifyCreateRequest()`/`resolveIntent()`/
`resolveCommunityIntent()`/`detectFriendDiscoveryIntent()` calls, same branching semantics,
HomeScreen's own `handleHomeIntentSubmit` already uses inline. `DiscoverHubScreen.js`'s search box
now runs a query through it on explicit submit (Enter/Search key — not the live per-keystroke
debounce the literal search still uses, since this costs a real LLM round trip, same reasoning
Home's own box already follows) and renders an "understood as" panel above the existing literal-
match sections: a real title (an assembled Experience's own title when one genuinely applies, e.g.
"✨ Your Date Night", else a category-based fallback), honest tag chips (📍 Nearby, 📅 the real
dateWindow bucket, ❤️/👥/🧍 from partyType), then the real matching gatherings/communities/perks/
businesses. Purely additive — literal per-section results are untouched and still render alongside
it. Also extracted `navigateToIntentResultItem()` (the per-type routing switch both HomeScreen's
`handleIntentResultTap` and Discover's own new result rows need identically) and
`buildFriendDiscoveryResultItem()` out of `HomeScreen.js` into the same shared module — HomeScreen
now imports both instead of keeping its own copies (mechanical extraction, verified same resulting
behavior via diff), so the two search surfaces share one routing rule instead of two that could
drift. Deliberately did NOT fold `handleHomeIntentSubmit` itself into `runIntentSearch()` — that
inline code has several Home-specific concerns interleaved (Surprise Me clearing, RSVP nudges) and
no automated coverage in a codebase with no simulator/device testing available, so refactoring it
now would be real regression risk for no behavioral gain; both call sites already compose the
identical underlying functions with the same params, which is what "the same language" actually
requires. `create-assistant`'s prompt gained two small real gaps closed as part of this: a plain
"Saturday"/"Sunday" (no other timing word) now explicitly maps to the existing "weekend" bucket
(previously undefined behavior), and "with my girlfriend"/"with my boyfriend" were added as
explicit `partyType` examples alongside "with my partner" — both additions to already-existing
bucket vocabulary, not new specific-date inference, consistent with the standing "AI never infers
or assigns a specific date/time from free text" rule. Edge Function redeployed and confirmed live
via the Management API's function-body endpoint. Full Jest suite 280/280 passing; all four touched
files transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running
app (no simulator/device tooling this session, standing note). Commit: `62612669`.

**Item 38 ("don't force the user to know the app's terminology") — fully DONE (2026-09-11).**
Picked up a genuine in-flight, uncommitted change found at session start: `create-assistant`'s
prompt (the Edge Function behind `CreateHubScreen.js`'s "Something Else" free-text box) had
already been edited to extract `category`/`partySize`/`dateWindow`/`budgetMax`/`priceLevel`/
`partyType`/`attributes`/`cuisine`/`occasion` regardless of classified intent — previously
`category` was only ever extracted for `gathering`/`community` — with a comment noting an
"unclear" request like "can someone find me a good place for dinner?" correctly classifies as
unclear (it doesn't describe hosting/starting anything) but Nearby should still search relevantly
for it. That half was done; the client side wasn't: `CreateHubScreen.js`'s own `handleAskAssistant()`
still routed every "unclear" classification into `CreateGathering` with the raw typed text as a
literal title — exactly the terminology-forcing bug the item describes (the user says "find me a
place," the app forces them into "create a gathering called 'find me a place'"). Fixed: that branch
now routes to `AskBusinessScreen` instead, prefilled from the same `classifyResult` shape
HomeScreen's own `goAskBusiness()`/`business_availability` branches already use to prefill the
identical screen — the real matching product object, never auto-submitted. Deliberately left
`routeClassifiedIntentToCreation()` (Home's "None of these? Create it yourself" / Discover's
completion CTA) unchanged and documented why in its own comment: both of its callers only reach
"unclear" after the user already saw and rejected every real match `resolveIntent()` found, so
CreateGathering is the correct, already-informed landing spot there — a genuinely different context
from CreateHubScreen's first-touch box, which has no results-review step at all. The first example
in the item ("get 6 people together for dinner Friday" → a gathering) was already correctly handled
by existing `gathering`-intent routing; not changed. Edge Function redeployed
(`npx supabase functions deploy create-assistant`) and confirmed live via the Management API's
function-body endpoint (new prompt strings present in the deployed bundle). Full Jest suite 280/280
passing; both touched client files transform-checked clean via `@babel/core` + `babel-preset-expo`.
Not exercised in a running app (no simulator/device tooling this session, standing note). Commit:
`e7d7e6ba`.

**Item 37 ("make the primary CTA context-aware") — fully DONE (2026-09-11).** Full findings:
`PRODUCT_AUDIT/CONTEXT_AWARE_PRIMARY_CTA_2026-09-11.md`. Audited all 6 named contexts by reading
each screen's real button JSX + styles to check which button is *visually* primary (filled coral)
vs secondary, not just which exists. Two real gaps found and fixed: `ViewProfileScreen.js` had
"💬 Message" as the coral primary and "🤝 Plan Something" as the outlined secondary once connected
as both friend and match — swapped, and renamed to "🤝 Plan Together" to match the user's wording
(only when `friendshipStatus === 'accepted'`; a pure dating match still shows Message as primary,
correctly, since nothing else is actionable yet). `BusinessProfileScreen.js` had "+ Follow" as the
coral primary and "📅 Make a Plan Here" as the *weakest*-styled button on the screen (gray outline)
— swapped, renamed to "📅 Plan Here"; Follow is now always outlined, never filled, in both states.
Community (`CommunityDetailScreen.js`) and Gathering (`GatheringDetailScreen.js`) were already
correct — no changes. "Event" is not a distinct concept anywhere in this schema (folds into
Gathering per item 27's own same-day audit) — flagged rather than fabricating a parallel UI state
with no real data distinction behind it. Search results: `DiscoverHubScreen.js`'s existing
"nothing matched anywhere" escape hatch (item 26) was already coral-primary and correctly gated
(empty-state only, never alongside real results) — renamed "Create it →" to "Create What You're
Looking For →" to match the user's wording; `GatheringsScreen.js`'s own more-specific "+ Start a
{term} Gathering" CTA was deliberately left as-is (more informative for its single-type context).
Full Jest suite 280/280 passing (no test files touched); all three touched files
(`ViewProfileScreen.js`, `BusinessProfileScreen.js`, `DiscoverHubScreen.js`) transform-checked
clean via `@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device
tooling this session, standing note).

**Gathering-interest threshold push ("3 people nearby are planning X") — fully DONE (2026-09-11).**
The one explicitly-named deferred piece from item 17's own migration
(`20261004_recommended_for_you_push.sql`'s header comment): a brand-new gathering has zero
attendees at the moment its own creation trigger fires, so the "X people nearby are planning
this" social-proof copy needed its own separate trigger on real accumulating interest, not
gathering creation. Shipped as `notify_gathering_interest_threshold()`
(`20261008_gathering_interest_threshold_push.sql`), an `AFTER INSERT` trigger on
`gathering_interest` mirroring `notify_group_intent_threshold()`'s own "fire exactly once, at the
real threshold crossing" shape — fires only when a gathering's real interest-row count hits
exactly 3 (any status; a real gathering_interest row already means real expressed intent, not
confirmed attendance), never again for the 4th/5th/etc. person. Recipients are the exact same
interest-matched, presence-based, distance/time-pref/frequency-gated population
`notify_matching_things_to_do()` already computes for gathering creation, reused rather than
re-derived, minus the host and minus anyone who already has their own interest row for that
gathering; shares `recommendation_push_log`'s `source_type='gathering'` bucket and therefore the
same daily frequency cap as the creation-time push (one shared budget per user, not a second
independent one). No client changes needed — reuses the exact same `recommended_gathering` push
type `notifications.js` already routes to `GatheringDetail`. Verified live via a disposable
rolled-back transaction before applying for real — a first version of the test used one
multi-row `INSERT ... VALUES (a),(b),(c)` for the 3 interest rows and incorrectly showed 3 pushes
instead of 1 (all 3 AFTER-ROW triggers in one multi-row statement see the same final
post-statement count, since PostgreSQL fires AFTER ROW triggers only once every row in the
statement is already inserted) — re-verified with 3 separate single-row INSERTs, which is what
the app's real `join_gathering` RPC actually does (one row per user action), and got the correct
result: exactly one push, to the correct candidate, with the already-interested/wrong-interest/
host candidates all correctly excluded, and no re-fire at a 4th interest row. Confirmed live
afterward via `pg_proc`/`pg_trigger`. Full Jest suite 280/280 passing (no client files touched).
Not exercised in a running app or against a real device (no simulator/device tooling available
this session, standing note).

**Item 36 ("one intent → action pattern everywhere") — fully DONE (2026-09-11).** User's framing:
I want something → Nearby understands → shows options → I choose → Nearby helps make it happen —
audited against 4 example chains (dinner → restaurants → friends/match → availability → plan →
reservation; tonight → events/options → invite people → plan; meet people → Dating/Friends →
relevant people → connect → plan something; build something → Community/Gathering → create →
attract people → connect businesses). Full detail: `PRODUCT_AUDIT/INTENT_ACTION_PATTERN_2026-09-11.md`.
Chains 2 ("tonight"), 3 ("meet people"), and 4 ("build something") were already complete
end-to-end, verified by reading the real code paths (not re-trusted from memory). Chain 1
("dinner") had one real gap: resolving "dinner" landed on a fully solo `AskBusinessScreen` with
no way to deliberately bring a specific connected friend/match. **Initial design (pre-submission
companion picker) was locked, a build fork started against it, then the user reviewed and
redirected to a different shape before anything was committed** — nothing from that original plan
ever touched production; full clean slate. **Shipped design**: submission stays exactly as-is
(solo, no gate, zero added friction); an unobtrusive "👤 Invite Someone" expand-in-place section
on `BusinessRequestDetailScreen.js` (also literally the post-submit confirmation screen) lets the
owner invite a real connected friend or match *after* submitting, reusing the existing group-plan
consent architecture (`group_plan_proposals`/`group_plan_participants`/`respond_to_group_plan`/
`confirm_group_plan`, all read live via `pg_get_functiondef` before building, none modified) via a
new `invite_to_business_request` RPC (`20261007_invite_to_business_request.sql`) that auto-creates
a never-fanned-out placeholder request on the invitee's behalf to satisfy the participants table's
own FK, then relies on the existing generic accept/decline/confirm flow for everything downstream.
Verified live via a disposable rolled-back transaction (real friend/match invited while a stranger
is silently skipped; idempotent re-invite rejection; a blocked pair excluded despite being
connected; existing `respond_to_group_plan` confirmed fully generic over the new row shape), then
applied for real. Full Jest suite 280/280 passing throughout; every touched file transform-checked
clean. Not exercised in a running app — no simulator/device tooling available this session.

**Thursday plan items 34 & 35 (contextual loading states; "why am I here?" 7-question coherence
audit across Discover/People/Create/Plan) — fully DONE (2026-09-11).** Full findings:
`PRODUCT_AUDIT/DISCOVER_PEOPLE_CREATE_PLAN_COHERENCE_2026-09-11.md`. Item 34: 10 files gained real
contextual loading copy ("Finding things nearby…", "Finding people who match…", "Finding
availability…", "Building your options…") on genuine in-flight fetch/search moments that
previously had bare spinners — `HomeScreen.js` (intent resolution + Surprise Me),
`DiscoverHubScreen.js` (6 spinners), `FriendDiscoveryScreen.js` (mode-aware), `GatheringsScreen.js`
(+ all 11 locale translations of its generic "Loading..." initial-load string),
`PlacesScreen.js`, `CommunityDetailScreen.js`, `CreateGatheringScreen.js`,
`CreateHubScreen.js`, `DateProposalScreen.js`. Item 35: ran the user's own 7-question test against
all 14 screens in this cluster; verified (not just re-trusted) that items 8-33's prior work still
holds, specifically hunted for state-lost-on-return (Q6) and duplicated-navigation (Q4) bugs —
none found. No architecture-level consolidation proposal raised: this cluster's current
state-driven shape (DiscoverHubScreen mode/sub-mode/expand-in-place, CreateHubScreen's inline
assistant, FiltersModal/QuickFilterCustomize as in-place layers) was already built specifically to
avoid screen proliferation in prior sessions, not something this pass needed to fix. Full Jest
suite 280/280 passing; all touched files transform-checked clean. Not exercised in a running app
(no simulator/device tooling this session, standing note). Commits: `0bca8420`, `94277779`.

**Thursday plan items 32 & 33 (standardize relationship states; standardize action-verb
semantics) — fully DONE (2026-09-11).** Two global audits requested directly by the user, each
run as a background research fork (to survey the whole codebase without blowing up context),
each ending in concrete fixes, not just a report:

- **Item 32** (relationship states) — audit found 2 real bugs + 1 structural risk, all fixed:
  `block_and_unmatch()` never deleted the `friendships` row on block, so a blocked former friend
  stayed listed as a Friend on `FriendsScreen`/`ProfileScreen` while `ViewProfileScreen` correctly
  blanked their profile (exactly the "contradicting states across screens" failure described) —
  fixed in `20261006_block_clears_friendship.sql`, verified live via a rolled-back dry run before
  applying for real; `getCommunityMembers()` didn't filter blocked users, unlike every sibling
  roster function — fixed with the same blocked-both-directions pattern `getFellowAttendees()`
  already used; no canonical relationship-status function existed anywhere — extracted
  `getRelationshipStatus(otherUserId)` into `src/services/friends.js` and refactored
  `ViewProfileScreen.js` (the only real consumer) to use it instead of 3 separate inline queries.
  Candidate pools (dating swipe, friend swipe) were both already correctly excluding blocked/
  already-connected people — no bug there. Full matrix + audit methodology:
  `PRODUCT_AUDIT/RELATIONSHIP_STATE_MATRIX_2026-09-11.md`.
- **Item 33** (action-verb semantics) — audit found 5 real label/destination mismatches, all
  fixed: `GatheringDetailScreen.js`/`CommunityDetailScreen.js`'s shared business-help chooser
  labeled both its options "Ask..." despite routing to two deliberately different flows (reworded
  the `RequestBusinessPartner` one to "Request a specific business"); `MatchesScreen.js` used
  "Plan" for two different destinations (direct-to-DateProposal vs. the 12-option "Do Something
  Together" menu) — the menu branch relabeled to "Do Something"; `GatheringsScreen.js`'s "I'm
  Interested" button (and its `GatheringIntentModal` call) used a generic label while
  `GatheringDetailScreen.js`'s identical action already used the real three-way "Join Gathering"/
  "Request to Join"/"Join Waitlist" label for the same `gathering_interest` insert — applied the
  same computation; two smaller outliers ("Start a Community from This Gathering" →  "Create a
  Community...", "Start a Gathering" → "Host a Gathering") renamed to match their own screens'
  canonical titles used everywhere else. Save/Discover/Message/Ask-vs-Request-at-every-other-entry-
  point verb families were all already consistent — no changes needed there.

Both audits' full findings (including what was checked and found already-consistent, not just
what got fixed) are in the fork reports; the fix commits' own messages carry the same detail. Full
Jest suite 280/280 passing throughout; every touched file transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
this session, standing note).

**Thursday plan items 30 & 31 (Home/Discover/Create clarity; Profile is about ME) — audited,
mostly already-DONE, one real concrete gap closed (2026-09-11).** Both items turned out to be
close restatements of architecture already built and iterated on across many prior sessions —
verified by reading the actual current code, not assumed from memory.

**Item 30** (Home = "what do you want to do", Discover = "here's what's available", Create =
"here's how you make something happen"): already true in both navigation and content. Only 4 tabs
exist (`RootNavigator.js`: Home/Discover/Create/Activity), and each screen's own literal framing
text already independently arrived at almost the user's exact wording — Home's ask box literally
says "What do you want to do?" (Phase 1a of the Intent Layer plan); Discover's subtitle reads
"What's happening nearby"/"Who's around you" per mode; Create's reads "What do you want to
create?". Home's own sections (Quick Picks, Nearby Right Now, Happening Near You, Because You
Like…) are all small, personalized/algorithmic picks, never an exhaustive raw browse — that stays
Discover's job, a real, checked distinction. The one place Discover links to Create
(`DiscoverHubScreen.js`'s "+ Create a {topic} Gathering →" inside an empty Gatherings section) is
the correct escape-hatch relationship the user's own model implies (Discover shows what's real;
when nothing's real, it hands off to Create rather than fabricating content), not a boundary
violation. No code changes made — nothing to fix.

**Item 31** (Profile about ME: identity → what can I do with them; own Profile emphasizes
identity/interests/plans/communities/activity, Settings separate): `ViewProfileScreen.js` already
matches the "who are they, then what can I do" shape closely — photos/name lead, then real
primary actions (Message only when a real `matches` row exists; Plan Something only once friends
are `accepted`; Friends ✓ / Request Sent / Add Friend / Accept-Decline reflecting real
`friendships` state), with Report/Block tucked into a header "⋯" menu rather than competing for
attention, and no discovery-surface bleed (no "people like this" feed at the bottom). The one real
state overlap (Add Friend button shown alongside Message, for a dating match who isn't yet a
formal friend) is two independently true facts, not a bug — confirmed via the code's own
`on_friendship_accepted_create_match` note that friend-acceptance always creates a real match too,
so pure "connected but not `matches`-linked" friends can't actually happen. Own `ProfileScreen.js`
already led with a real identity snapshot (Aug 23 2026 IA pass) and already had Plans → Connections
(Communities/Friends) → Story (Timeline/Memory Vault/Activity/Occasions) sections in almost the
user's own order, with Settings reached only via a separate gear icon. The one real, concrete gap:
**interests had no read-only summary near the top** the way Plans/Connections already did — only
the toggleable chooser far down inside "Edit Your Profile." Added a "My Interests" read-only
section right after the identity snapshot (before "Your Plans"), reusing the exact chip treatment
`ViewProfileScreen.js` already uses to show a *real other person's* interests — the editable
chooser is untouched, still the actual editing tool. Full Jest suite 280/280 passing;
`ProfileScreen.js` transform-checked clean via `@babel/core` + `babel-preset-expo`. Not exercised
in a running app (no simulator/device tooling this session, standing note).

**Thursday plan item 29 (notification categories — "an intelligent layer, not a firehose") —
fully DONE (2026-09-11).** Picked up after a codespace restart mid-build — an untracked
`.wip_notification_categories/` scratch directory (originals + partially-fixed copies of every
push-sending DB function, 45 of 59 already converted) was found, checked against the user's own
locked spec, and completed rather than restarted: the remaining 14 files were fixed following the
exact same mapping pattern the prior partial pass had already established. Per the user's own
spec, replaced the growing, ungoverned pile of individual per-feature `notify_*` booleans
(friends/dating/messages/waves/plans/things_to_do/nearby_opportunities/crossed_paths/
businesses_offers — several generations of one-off additions, see item 17's own history) with 6
named categories a user controls independently: Social, Discovery, Proximity, Planning, Business,
Community. Every one of the 59 functions in the schema that sends a push was individually
re-gated onto the 6 new columns — verified live afterward with a query for any function still
calling `send-push` without referencing one of the 6 (zero found). This full audit surfaced a
real, previously-undocumented gap: 12 business-side functions (`_accept_business_offer_internal`,
`_business_request_fanout`, `_match_request_to_availability`, `_match_request_to_policy`,
`_ai_auto_respond_to_business_requests`, `accept_business_offer`,
`admin_review_business_content_screening`'s offer-response branch,
`approve_business_partner_request`, `deny_business_partner_request`,
`notify_aggregated_demand_threshold`, `post_business_availability`,
`request_more_business_partner_info`, `respond_to_business_partnership_request`) fired pushes with
**no preference check of any kind** before this change — all now gate on `notify_business`.
`notify_community_area_demand_threshold` gates on `notify_community`; `cancel_community` gains its
first-ever gate, also `notify_community`. Mapping for the rest: notify_friends/dating/messages/
waves → notify_social; notify_things_to_do/nearby_opportunities → notify_discovery (their own
separate frequency/distance/time-pref/categories sub-preferences from item 17 are unchanged —
only the plain on/off master switch collapsed); notify_crossed_paths → notify_proximity;
notify_plans → notify_planning; notify_businesses_offers → notify_business. Migration
(`20261005_notification_categories.sql`) backfills existing users' 6 new columns honestly from
whatever they'd already set on the old ones (OR'd across every folded-in constituent, so a user
who'd opted out of everything in a now-shared category stays opted out), then drops the 9
fully-superseded old columns. Verified live: rolled-back dry-run transaction first (confirmed
clean apply + the specific gate/backfill assertions), then applied for real and re-confirmed
against production directly (6 new columns present, 0 old columns remaining, 0 ungated
`send-push` callers anywhere in the schema). `SettingsScreen.js` collapsed from 9 toggles to 6,
each with real descriptive subtext; Discovery keeps both existing "Things To Do"/"Nearby
Opportunities" customize sub-panels (now nested under its own toggle rather than each having its
own separate master switch). Full Jest suite 280/280 passing; `SettingsScreen.js` transform-
checked clean via `@babel/core` + `babel-preset-expo` (this repo's own `npx babel` resolves to a
stale global shim that fails on any modern syntax — use `require('@babel/core').transformFileSync`
directly, per this repo's own established precedent). Not exercised in a running app (no
simulator/device tooling this session, standing note). One unrelated pre-existing dead column
found during this audit, deliberately not touched (out of the scope actually asked for):
`profiles.notify_matches`, superseded by the Sep 13 2026 "Phase E" 7-category taxonomy per that
change's own code comment, but never dropped — no live function references it.

**Thursday plan item 28 ("Surprise Me") — fully DONE (2026-09-11).** Picked up mid-stream after a
usage-limit restart (the prior session's untracked `surpriseMe.js`/`surpriseMe.test.js` were
read in full and checked against the locked spec — both were correct and complete, no rewrite
needed; a real bug was found and fixed in `pickSuggestion()`, which assumed its pool argument was
pre-sorted by score instead of picking the max explicitly). Shipped exactly per the user's own
4-part locked spec: a small "✨ Surprise Me" text-link beside Home's ask box (never competing with
the coral "Find it" button); an inline quick-picker sheet (`SurpriseMeSheet.js`, a full-screen
slide `Modal`, same pattern `FiltersModal.js` already established) for When (Now/Today/This
Weekend, `gatheringDateFilter.js`'s real `DATE_OPTIONS` keys) and Mood (Social/Chill/Active/
Foodie/Date/Something New, each mapped to real existing occasion/attribute/partyType/category-tag
vocabulary in `surpriseMeLogic.js` — no free text, no new screen); one assembled suggestion
(`assembleExperience()` when the mood's occasion has a real template, else the top-scored real
`resolveIntent()` candidate) with a "You could go with {name}" enrichment only when a real
accepted friend/match's own `profiles.interests` genuinely overlaps the suggestion (never a
stranger, never forced); and a Shuffle Again that re-rolls within the already-fetched candidate
pool, only re-fetching over the network when that pool is genuinely exhausted. No new DB
migration, table, or location code — pure client-side reuse of `resolveIntent`/
`assembleExperience`/`getMyFriends`/`getMyMatches`. Full Jest suite 280/280 passing (22 new
tests); all four touched/new files (`HomeScreen.js`, `SurpriseMeSheet.js`, `surpriseMe.js`,
`surpriseMeLogic.js`) transform-checked clean under `babel-preset-expo`. Not exercised in a
running app (no simulator/device tooling this session, standing note). Commits: `7cef8df1`
(service layer), `d3c9d6b6` (Home UI wiring).

**Thursday plan item 27 (one ontology, not category = X on one screen and category = Y on
another) — audit-only, fully DONE, no code changes needed (2026-09-11).** Direct restatement of
the standing `project_intent_engine_vision` memory's own vision. Code-verified, not guessed from
memory: checked all 12 pipeline stages the critique named (user interests, intent, Discover,
Gatherings, Communities, Businesses, Events, Recommendations, Notifications, Search, Matching,
Business offers) against the actual current code. **Bottom line: the ontology is already unified
everywhere data actually gets matched** — gatherings/communities/perks/business postings/
recommendations/notifications/search/compatibility all read the same `interest_tag`/
`profiles.interests`/`categories` values, sourced from the one `INTEREST_OPTIONS`/`CATEGORY_GROUPS`
list (`gatheringCategories.js`). "Events" isn't a distinct concept anywhere in the schema — folded
into Gatherings' `interest_tag`, matching the vision doc's own "Events should be cross-category,
not a category" note, so there's nothing to fragment. Three low-risk nits found, none live bugs:
(1) `brandOffers.js` matches interests via a per-item `.toLowerCase()` string loop instead of the
array-containment operator (`@>`/`&&`) every other matcher uses — cosmetic, would only bite on a
future casing mismatch; (2) `BUSINESS_CATEGORIES` (the business-major-category list) is a
hand-maintained array that currently mirrors `CATEGORY_GROUPS`'s majors rather than being derived
from it — in sync today, nothing enforces it stays that way; (3) `businessCategoryClassifier.js`'s
free-text keyword map is necessarily its own hardcoded dictionary (classifies prose into
`BUSINESS_CATEGORIES`), inheriting nit (2)'s same caveat. None of the three were fixed — all are
maintenance-burden observations, not fragmentation a user could ever actually hit, and fixing (2)
would mean choosing whether `BUSINESS_CATEGORIES` should just become `CATEGORY_GROUPS`'s own major
keys, which is a real (if small) design call better posed to the user than silently done.

**Thursday plan item 26 (consistent "escape hatch" — never dead-end a search) — fully DONE
(2026-09-11).** An audit of every genuine "searched/browsed and found nothing, no path forward"
moment beyond item 25's own sweep. Most surfaces already had a real escape hatch, some predating
this session: `DiscoverHubScreen.js`'s unified search already routes a true "nothing matched
anywhere" search through `classifyCreateRequest()` into a real Create It flow (`nothingMatchedAnywhere`,
built 2026-08-27); `GatheringsScreen.js`'s search-empty state already offers a prefilled "Start a
[term] Gathering" (item 25 batch 2); `CommunitiesScreen.js` has no free-text search to dead-end on
at all; Home's ask-box and `CreateHubScreen.js`'s "With businesses" row already cover the
business-request escape hatch (items 4/20). Two real gaps found, both in Places (a Google-
Places-backed browse — a place can't be "created" the way a gathering/community can, so the right
escape hatch is asking businesses directly, not creating supply): `DiscoverHubScreen.js`'s
embedded Places section and the dedicated `PlacesScreen.js`'s "Nothing found nearby" state both
gained an "Ask Nearby Businesses →" action into `AskBusinessScreen`, free-text prefill only
(`PLACE_CATEGORIES` and `AskBusinessScreen`'s own leaf-tag category chips are deliberately
separate vocabularies — see `placeCategories.js`'s header comment — so this never silently
pre-selects a chip that might not actually match); `PlacesScreen.js`'s location-denied state had
no action at all (a hard dead end), fixed with a real "Enable Location →" button re-running the
screen's own existing permission flow. Full suite 258/258 passing; both touched files
transform-checked clean. Not exercised in a running app (no simulator/device tooling this
session, standing note). Commit: `3f197cd5`.

**Thursday plan item 25 (empty states need real next-actions) — fully DONE (2026-09-11).** An
audit fork inventoried the app's empty states; four batches closed every real gap it found across
the highest-visibility surfaces:
- **Batch 1** (`61cf05db`) — People/Matches/Friends: `DiscoveryScreen.js`'s browse-filtered/
  crossed-paths-filtered/first-visit empty states merged into one `renderPeopleEmptyState()` with
  real Adjust Filters/Invite Friends/Adjust Preferences actions; `FriendDiscoveryScreen.js` got a
  real Clear Filters action; `FriendDiscoverySwipeCards.js` got Invite Friends;
  `MatchesScreen.js` got Explore Things To Do + Invite Friends; `FriendsScreen.js` got a direct
  Meet New People action and its "no circles yet" modal now opens the real New Circle modal
  instead of pointing back at the screen it's already on.
- **Batch 2** (`56ded70b`) — Discover/Communities/Gatherings: `DiscoverHubScreen.js`'s category
  drill-down and all 4 unified-search empty states got real actions, including a genuine new
  `enableLocation()` (`requestForegroundPermissionsAsync` — `loadCore()` previously only ever
  checked existing permission, never prompted); `CommunitiesScreen.js` got a real Create a
  Community button; fixed a real bug in `GatheringsScreen.js` where the Nearby tab's "+ Start a
  Gathering" button was wrongly gated on a search/filter being set and so never rendered for the
  true first-visit empty state its own copy promised it to.
- **Batch 3** (`2ae744ae`) — `ActivityScreen.js`'s "Nothing new yet" got Explore Things To Do +
  Discover People actions (`notices.emptyText` checked and confirmed an orphaned, uncalled
  translation key — nothing to fix there).
- **Batch 4** (`ab06cf16`) — `BusinessDashboardScreen.js`: most of the 10 flagged empty states
  already sat beside a real always-visible action button, or are genuinely passive received-not-
  created displays (requests inbox, aggregated demand, offer performance, insights, missed/
  declined history) where forcing a CTA would be a fabricated action — left as honest empty
  states per this repo's no-fabricated-signals convention. Two were real gaps; fixing them
  surfaced a real pre-existing bug — both copy blocks promised "create one from the Create tab
  and it'll show up here," but `getMyBusinessGatherings()`/`communities.js` scope this section to
  `hosting_partner_id` = this business, and no create flow anywhere in the codebase
  (`CreateGatheringScreen.js`, `CreateCommunityScreen.js`) ever sets that column — the promise was
  already false. Softened the copy to drop the unfulfillable claim and pointed the new action at a
  real destination instead; wiring an actual business-hosted create path is flagged in-code as a
  separate, bigger feature, not silently built.

Full suite 258/258 passing throughout; every touched file transform-checked clean under
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note).

**"Thursday plan" (external UX critique items 18-24, "one connected system" objective) — fully
DONE (2026-09-11).** User's overarching ask: Nearby should feel like one connected system
(Discover → find people → decide to do it → create a plan → connect a business/place → go do
it), not a collection of separate screens. Two research forks audited the actual current state
against all 7 items before any code changed — most of it was already built from prior sessions;
only real, concrete gaps got code changes:
- **#18** (unified Discover hierarchy: What are you looking for? → Things to Do | People → sub-
  tabs, filters as content not navigation) — **already fully built**, no code needed.
  `DiscoverHubScreen.js`'s `mode`/`peopleSubMode` are in-screen state, not routes; Things-To-Do's
  category drill-down is the Phase 8 "expand in place" mechanism, also not navigation.
  `StoriesRow.js` confirmed gone (per the 2026-09-10 Discover UX cleanup).
- **#19** (filters should sit as a layer over results, never a navigation destination) — mostly
  already true (`FiltersModal` was already a real in-place modal). One real gap: the deeper
  `QuickFilterCustomize` screen it links to was a full stack push. Fixed:
  `presentation: 'modal'` in `RootNavigator.js`.
- **#20** (Create as Discover's inverse, same taxonomy powering both) — mostly already true
  (`CreateHubScreen.js` already mirrors Discover's own framing and sources `CREATE_HUB_OPTIONS`/
  `SUB_OPTIONS` from the same `INTEREST_OPTIONS` taxonomy). One real gap: no path to
  `AskBusinessScreen` (the "post a request, any business can respond" flow, distinct from the
  Phase 7 "Request a Business Partner" affiliate flow deliberately removed from this screen
  earlier) — it was only ever reachable *from* an existing gathering/community/match/Home-ask
  context. Added a "With businesses" row, navigated with no params (a genuinely blank ask).
- **#21** ("Plan" should exist everywhere it logically can) — mostly already true
  (`ViewProfileScreen`/`GatheringDetailScreen`/`BusinessProfileScreen` all already have a real
  Plan-type CTA reusing the same planning engine, `dateProposals.js`). One real gap:
  `MatchCelebrationModal` (shown right after a new match) offered only Message/dismiss. Added a
  "Plan Together" button routing to the same Together-menu destination the match row's own
  "🤝 Plan" button already uses.
- **#22** (business as the natural endpoint of Person + Intent → Activity → Place, not a separate
  ad section) — **already satisfied** by prior work: the intent resolver's `business_availability`
  results, Experience Bundles, and `DateProposalScreen`'s "Find something nearby" search (item 4)
  already implement exactly this flow; Discover's own Perks section is woven into the same
  unified results list, not a separate sponsored unit. No code change needed.
- **#23** (every recommendation should explain WHY) — real, confirmed gap on two of four
  surfaces. Gatherings and Friends discovery already had real reason text (`getGatheringFitReasons`,
  `FriendDiscoverySwipeCards`'s `sharedBits`). Fixed: `SwipeableDiscoveryCards.js` (dating swipe
  deck, plain Browse mode) now shows the same tappable compatibility "Why?" badge + shared-
  interests line the list view (`DiscoveryScreen.js`) already had, reusing the same already-
  computed `item.compatibilityScore`/`item.sharedInterests` fields. `business_availability`
  intent results (and the Experience Bundles/components that reuse the same candidate objects)
  had zero why-reasoning at all — new `getBusinessAvailabilityReasons()`
  (`intentResolverScoring.js`) mirrors each existing scoring bonus's own exact condition
  (category/subcategory/secondary-category, distance, cuisine, attribute, party-type, occasion)
  and surfaces real text for whichever ones actually fired, appended to the existing title/price
  subtitle. New Jest coverage.
- **#24** (social proof honesty — never display a count not calculated from verified underlying
  relationships) — the specific bug the user remembered ("said 3 when there was only 1") was
  **already fixed** in a prior session: `homeDashboard.js`'s `friendsActivity` dedupes by
  `host_id` before capping at 3, with an explicit code comment naming this exact failure mode. No
  other fabricated/stale social-proof count found in the surfaces checked (not exhaustive —
  community screens, `FriendsScreen`/`MatchesScreen` copy, and all push-notification bodies
  weren't individually re-checked this session).

Full suite 258/258 passing throughout; every touched file transform-checked clean under
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note). Commits: `1cad107d` (19/21/23-dating), `3678bfb3` (23-business), `2ccd3e39` (20).

**"This matches you" recommendation push notifications, external UX critique item 17 — fully
DONE (2026-09-11).** Real push notifications for gatherings/communities and business postings
that genuinely match a user's own declared interests, with real controls (on/off, frequency,
categories, distance, time preferences) — not the two dangling "honest placeholder" toggles
(`notify_things_to_do`/`notify_nearby_opportunities`, added 2026-09-13 with zero real trigger)
they were before. Scoped down to 3 concrete architecture decisions via `AskUserQuestion` before
building (all confirmed by direct user answer): (1) reuse the existing background-presence
pipeline's coarse last-known location rather than add any new location capability — and a real
finding *during* that research made this free: `presence_reports` (user_id pk, area, reported_at,
upserted by `report-presence`) already existed as exactly that table, RLS-enabled with zero
policies (confirmed live), so no new table/Edge Function/permission was needed at all; (2)
real-time pushes, capped per day, not a daily digest; (3) a simple Anytime/Evenings & Weekends
time control, not a custom quiet-hours picker. Shipped: `20261004_recommended_for_you_push.sql`
— 8 new profile preference columns (frequency/categories/max-distance/time-pref × 2 categories),
a new `recommendation_push_log` table (frequency-cap tracking, RLS enabled/zero policies,
internal only), and two real `AFTER INSERT` triggers (`notify_matching_things_to_do()` on
`gatherings`, `notify_matching_business_availability()` on `business_availability`) matching on
real interest overlap (`profiles.interests`), real distance (haversine against the presence
table, respecting both the user's own preference and — for business postings — the posting's own
stated `radius_miles`), and real time-of-day/day-of-week checks against the row's own
`scheduled_at`/`starts_at`. Only ever considers `visibility = 'everyone'` gatherings (a
friends/invite-only/community-scoped gathering is not general discoverable supply — pushing it to
an arbitrary interest-matched stranger would violate this app's own no-stranger-discovery rule).
Verified live via a comprehensive disposable rolled-back transaction against production covering
all 8 real cases (genuine match fires; wrong interest/too far/stale presence/private-visibility
all correctly suppressed; the frequency cap holds a user at exactly 3 for `few_per_day`; a
business's own linked profile is never pushed about its own posting) before applying for real —
confirmed live afterward (triggers, all 8 new columns, `recommendation_push_log` all present).
Client, original shape: a standalone `RecommendationPreferencesScreen.js`, reached via a new
"⚙️ Frequency, categories, distance & time" link under each of the two existing Settings toggles.
**Refactored same day (2026-09-11), direct user pushback**: a whole navigation destination for 4
rows of controls fought this app's own "fewer screens, contextual disclosure" direction (the
Progressive Depth doctrine in Standing Conventions below). The screen is gone; its content is now
`src/components/RecommendationCustomizePanel.js`, an inline expand-in-place panel rendered
directly under each Settings toggle's own "Customize" link (local `expandedRecPanel` state in
`SettingsScreen.js`, no navigation). Same columns/behavior, same "categories = only your own
already-declared interests" scoping — purely a presentation change, not a data-model change.
`notifications.js` routes both new push types (`recommended_gathering` → `GatheringDetail`;
`recommended_business_availability` → the Discover tab, since no per-posting consumer detail
screen exists yet). Deliberately NOT
built, disclosed rather than silently skipped: the "3 people nearby are planning X" social-proof
copy variant from the user's own example — a brand-new gathering has zero attendees at the moment
its own INSERT trigger fires, so that needs its own separate trigger on `gathering_interest`
INSERT checking a real attendee-count threshold crossed (mirroring the existing
`notify_group_intent_threshold()` shape) — a real, distinct fast-follow. Full Jest suite 252/252
passing; a direct `@babel/core` + `babel-preset-expo` transform check passed clean on all four
touched/new client files. Not exercised in a running app (no simulator/device tooling this
session, standing note).

**"Build Something Bigger" section, external UX critique item 16 — fully DONE (2026-09-11).**
`CreateHubScreen.js`'s "Want to build something bigger?" section used to promise more than its
one real button ("Create a Community") delivered. Per direct user pick (via `AskUserQuestion`,
two rounds — first the overall approach, then the exact label for the new button): added a
second, genuinely distinct entry point, "🔁 Start a Weekly Meetup," which deep-links into
`CreateGathering` with `quickStartRecurring: true` — pre-selects "Repeats: Weekly" (and
pre-expands the "More options" section that setting lives in, so it's visibly selected rather
than silently sitting collapsed) while leaving the "What" step un-skipped and every field fully
editable, same "prefill but confirm" shape every other quick-pick path on this screen already
uses. Deliberately did NOT add "Host an Event" (redundant — the icon grid above this section
already does exactly that) or "Become a Local Organizer" (no organizer role/dashboard/workflow
exists anywhere in this codebase — would have been a fabricated feature). Deliberately did NOT
label the new button "Start a Community" despite that being the user's first instinct — it
creates a recurring *gathering* (`gatherings.recurring_series_id`), never a `communities` row,
and labeling it "Start a Community" right next to the real "Create a Community" button (a
genuinely different entity) would have had two adjacent buttons both saying "community" produce
two different kinds of thing. Full Jest suite 252/252 passing; a direct `@babel/core` +
`babel-preset-expo` transform check passed clean on both touched files
(`CreateHubScreen.js`, `CreateGatheringScreen.js`). Not exercised in a running app (no simulator/
device tooling this session, standing note).

**Taxonomy-aware search — fully DONE (2026-09-11).** Closed a real gap: `searchGatherings()`/
`searchPublicCommunities()`/`search_offer_ids()` used to only match title/description (name/
description for communities), completely blind to `interest_tag`/`target_interest_tag` — a
gathering tagged `Yoga` titled "Morning Stretch Session" was invisible to a search for "yoga."
All three now also ILIKE the tag column, merged client-side same as the existing columns. New
trigram GIN indexes (`20261003_taxonomy_aware_search.sql`) on all three tag columns, same
precedent as `20260809_indexed_text_search.sql`. Verified live: function body, all 3 indexes, and
`pg_trgm` extension all confirmed present in production via the Management API. Full Jest suite
252/252 passing. Full detail: `CLAUDE_HISTORY.md`, search "Taxonomy-aware search."

**"Things To Do needs a UX pass" — external UX critique item 14 — fully DONE (2026-09-11).**
`DiscoverHubScreen.js`'s default "All" Things-to-Do landing view (the one item 14 was about) no
longer shows a single quick-date-chip toggle silently reshaping one flat "Recommended For You"
list underneath it. It now shows four real, always-visible, consistently positioned sections in
the order the critique asked for — Happening Now (a small horizontal set), Today, This Weekend,
Categories — answering "where do I want to go / what do I want to do / when do I want to do it?"
directly instead of via a wall of independent tiles. All three time sections reuse the exact same
real date-bucket logic already earmarked for this in `utils/gatheringDateFilter.js`'s own header
comment (`matchesDateFilter`, the identical logic the dedicated Gatherings screen's own "When"
filter uses) and the same fit-scoring/hero-tiering already built (`getGatheringFitReasons`,
`HERO_SCORE`/`STANDARD_SCORE`, extracted into a shared `renderGatheringTile()` so the tile
treatment isn't tripled); each tier excludes whatever a more-urgent tier already showed so nothing
repeats. Categories is a real browse row over this codebase's own single canonical 19-group
taxonomy (`CATEGORY_GROUPS`, `constants/gatheringCategories.js`) — no invented list — reusing the
existing Phase 8 "expand in place" mechanism (generalized: `expandedContext` now supports a whole
category's tags, not just one gathering's own tag+time-bucket). The dedicated "Gatherings" tab and
the search-results view are both untouched (their own prior flat-list/notable-gatherings behavior
preserved exactly) — this only reshapes the default landing view. Full Jest suite 252/252 passing;
a `@babel/core` + `babel-preset-expo` transform check passed on the touched file. Not exercised in
a running app (no simulator/device tooling this session, standing note).

**Discover UX cleanup items 8 & 9 — fully DONE (2026-09-10)**, external UX critique reply. Item 8:
the People tab's separate Stories row is gone; the signal now lives on each candidate's own avatar
(a colored ring in `DiscoveryScreen.js`/`SwipeableDiscoveryCards.js`/`FriendDiscoverySwipeCards.js`,
tapping it opens the story directly, tapping the card body always opens the profile), and "post a
story" moved to a small camera icon in the People header (`DiscoverHubScreen.js`). `StoriesRow.js`
deleted outright. Item 9: user explicitly chose "leave as-is" for both open questions (no Age/
Intent/Lifestyle consolidation into Quick Filters; no distance filter for Dating) — no code
changed. Full locked design + build detail: `CLAUDE_HISTORY.md`, search "Discover UX cleanup items
8 & 9". Not exercised in a running app (no simulator/device tooling this session, standing note) —
full Jest suite (252/252) and a babel-transform syntax check on every touched file both pass.

**"Plan" means a real place, not a generic toolbox — fully DONE (2026-09-10)**, external UX
critique reply item 4. DB migration (`20261001_plan_something_real_supply.sql`) and all client
work (`dateProposals.js`, `DateProposalScreen.js`) shipped: proposing a plan now offers a real "🔎
Find something nearby" search over live business availability before the invite is sent, and
accepting a plan with a chosen place auto-creates the bound business request instead of requiring
a second manual step. Full build/verification detail: `CLAUDE_HISTORY.md`, search `"Plan" means a
real place`. Not exercised in a running app (no simulator/device tooling this session, standing
note) — full Jest suite (252/252) and a direct babel-transform syntax check both pass.

**Unified Crossed Paths across Dating and Friends — fully DONE (2026-09-10).** ONE Crossed Paths
mechanism shared by Dating and Friends, preferring real shared-past-gathering attendance
("You were both at {title} · {time}") over a proximity sighting when both are real for a pair,
never blending the two. New `get_shared_gathering_partners()` RPC
(`20260930_shared_gathering_crossed_paths.sql`, applied and functionally verified live via
disposable rolled-back transactions) and new `src/services/crossedPathsSignals.js` (pure
merge/format/filter functions, 16 Jest tests, full suite 252/252). `proximity.js`'s
`getNearbyMatches()` and the new `friendDiscovery.js`'s `getFriendCrossedPaths()` both source from
the merged sightings+gatherings union; `FriendDiscoveryScreen.js` gained a Browse | Crossed Paths
mode switch it previously lacked entirely. Fixed a real fabricated-signal bug found during this
work: `SwipeableDiscoveryCards.js` used to show "📍 Within about 35 feet" unconditionally even for
Browse-mode data with no real proximity signal. **Not exercised against a live authenticated
session** (no simulator/device available this session, per this repo's standing note) — if
something looks wrong in the running app, check `getNearbyMatches()`/`getFriendCrossedPaths()`
first. Full locked design, research, and build/verification detail: `CLAUDE_HISTORY.md`, search
"Unified Crossed Paths."

**Category/place/business taxonomy expansion (19 groups/75 tags) — fully DONE (2026-09-06),
picked up mid-stream after a codespace restart and shipped this session, then extended same-day
per direct user follow-up.** Gathering/community categories (`gatheringCategories.js`), Places
browsing (`placeCategories.js`, new), and business categories (`BusinessPartnerApplyScreen.js`,
`businessCategoryClassifier.js`) all now share one 19-category taxonomy (was 6 groups/26 tags for
gatherings, a separate 5-vertical list for business; first pass landed 15 groups/63 tags, then a
same-day follow-up added Stay & Getaway/Health & Personal Care/Education & Classes/Attractions &
Things to See). `brand_partners.category`/`business_partner_requests.category` widened via two
migrations (`20260922_business_category_taxonomy_expansion.sql`,
`20260923_business_category_taxonomy_v2_new_majors.sql`), both verified live. Found and fixed 3
real bugs left by the interrupted prior session that would have broken production on arrival: the
first migration's `update_business_profile()` rewrite targeted a stale 8-arg signature instead of
the real live 11-arg one; three Edge Functions (`submit-business-application`,
`screen-business-content`, `business-onboarding-assistant`) still validated/suggested against the
old 6-value list; a couple of smaller stale references (a Google-type-to-category guess table, a
dead import, a stale migration-filename comment, two literal old values in a disposable
live-verify script). Full build/verification detail: `CLAUDE_HISTORY.md`, search "Category/place/
business taxonomy expansion." `docs/business/` regenerated and recommitted twice
(BusinessDashboardScreen imports from a changed file).

**Standing direction, partially built**: the user's stated product vision (saved to memory,
`project_intent_engine_vision`) is that this taxonomy should power a free-text intent engine
underneath Discover's existing "what do you want to do?" ask box (`intentResolver.js`), never
become the app's primary category-picker navigation. **First increment of layer 4 (occasion)
shipped 2026-09-06**: create-assistant's already-extracted `occasion` (birthday/anniversary/
date_night/celebration/casual_hangout/business_meal/family_gathering) now threads through
`resolveIntent()` → `resolveBusinessAvailability()` → new `occasionBonus()` in
`intentResolverScoring.js`, scored against a business's own real `brand_partners
.priority_occasions` (flat bonus, never a filter, same shape as the existing attribute/cuisine/
party-type bonuses). `search_active_business_availability()` migration
(`20260924_business_availability_priority_occasions.sql`) adds `priority_occasions` to its return
columns — verified live. The same extracted occasion now also genuinely prefills
AskBusinessScreen's existing occasion chips end to end (Home → AskBusiness →
BusinessRequestDetail), fully visible/editable, never silently committed. **First increment of layer 2 (subcategory) also shipped 2026-09-06**, per direct user pick when
asked which piece to build next: a business's own durable self-classification
(`brand_partners.subcategory` / `business_partner_requests.subcategory`, both new columns) can
now hold a finer, real leaf-tag value under whichever major `category` the business already
picked — reuses `gatheringCategories.js`'s existing ~75-tag vocabulary directly (via the new
`subcategoryOptionsFor()` export), no second taxonomy invented. Wired into
`BusinessPartnerApplyScreen.js` (new applications), `BusinessDashboardScreen.js` (edit-profile
picker + profile-header display + defaulting the "Post Availability" category picker from the
business's own subcategory), `update_business_profile()`/`approve_business_partner_request()`
RPCs, and `screen-business-content`'s business_profile branch — every existing write path that
touches a business's category was individually re-checked and updated so none of them silently
null out subcategory on an unrelated edit (see this migration's own header comment,
`20260925_business_subcategory_layer.sql`, for the full per-callsite audit). **Both deferred pieces closed out the same day, per direct "keep going"**:
(1) the AI onboarding assistant (`business-onboarding-assistant` Edge Function,
`classifyBusinessDescription()`) now also extracts a best-effort `subcategory` alongside
category/attributes/cuisine/priorityOccasions, validated against that same call's own resolved
category so it can never mismatch majors — still manual-confirm like every other AI-suggested
field on that screen. (2) `search_active_business_availability()` now also returns
`brand_partners.subcategory`, and a new `subcategoryBonus()` in `intentResolverScoring.js` scores
it as a flat bonus in `resolveBusinessAvailability()` — a business's own *standing* identity
match now counts even when the specific posting itself is untagged or tagged differently,
distinct from (and additive to) the existing per-posting `row.category` match right above it in
that same function. Deliberately still NOT touched: `businessCategoryClassifier.js`'s
deterministic keyword classifier (inventing ~75 leaf-tag keyword lists is a real content/taste
decision better left for the user to weigh in on, not a mechanical extension like the two above).
**Layer 3 (general semantic tags) first increment shipped 2026-09-27, per direct user pick of
scope (expand the existing `businessAttributes.js` vocabulary + wire it into ranking, keep the
flat text[] structure, no new tags schema) — and the same pass folded in the "Hobbies & Interests
should be a semantic tag layer, not a category" item too, per direct "yes, fold it in."**
`BUSINESS_ATTRIBUTE_OPTIONS` grew from 8 to 18 values: 5 general quality/vibe tags
(`specialty_coffee`, `laptop_friendly`, `dog_friendly`, `waterfront`, `late_night`) and 5
hobby-adjacent tags (`board_game_friendly`, `photography_friendly`, `book_lovers`,
`craft_friendly`, `fitness_focused`) — any business in any category can self-tag "good for board
games," which is how a hobby mention in an ask reaches a matching business across categories
(the vision doc's own photography example) without a new category-fan-out mechanism. No new
resolver code was needed for ranking itself — `attributeAndCuisineBonus()`
(`intentResolverScoring.js`) already scores any overlap between an ask's extracted attributes and
a business's own `row.attributes` generically, vocabulary-agnostic by construction, so widening
the array was sufficient. Every touch point that validates/suggests/extracts this vocabulary was
updated together: `brand_partners`/`business_requests` `attributes` CHECK constraints
(`20260927_business_semantic_tags_expansion.sql`, applied and verified live with disposable test
data), `update_business_profile()`/`create_business_request()` (re-`CREATE OR REPLACE`d on their
unchanged signatures — confirmed single-overload before and after), `businessAttributes.js`'s
display vocabulary, `businessAttributeExtraction.js`'s deterministic "Teach Nearby" keyword list
(new Jest coverage added), and all three Edge Functions that had their own hardcoded copies
(`create-assistant`, `business-onboarding-assistant`, `screen-business-content`) — including each
one's own AI-prompt examples, since a value merely being in the valid-list enum without a
worked example rarely gets chosen. All three functions redeployed via `npx supabase functions
deploy <name> --project-ref enmosvippabmuqslzrox` and confirmed live via the Management API's
function-body endpoint (new tag strings present in the deployed bundle). Deliberately did NOT add
a separate "romantic" value — `date_friendly` already names that same real quality.

**Multi-classification businesses — fully DONE (2026-09-10), resumed after a genuine paused
handoff (2026-09-06 session cut short by weekly usage limit).** `brand_partners`/
`business_partner_requests` gained a `categories text[]` secondary, cross-major classification
array (reusing the same 75-tag `INTEREST_OPTIONS` vocabulary `subcategory` already uses) —
DB layer (`20260928_business_multi_classification.sql`), resolver scoring
(`secondaryCategoryBonus()` in `intentResolverScoring.js`, same flat-bonus weight as
`occasionBonus()`/`attributeAndCuisineBonus()`, capped so more tags can never outrank a real
subcategory match), every write path (`brandOffers.js`, `screen-business-content`,
`BusinessDashboardScreen.js`, `BusinessPartnerApplyScreen.js`), and the public
`BusinessProfileScreen.js` display all shipped and verified live. Bundled fix: `create-assistant`'s
own hardcoded `VALID_CATEGORIES` copy was found stale a second time (still the pre-expansion
26-tag list) and widened to the real 75-tag list, redeployed and confirmed live. Full build/
verification detail: `CLAUDE_HISTORY.md`, search "multi-classification businesses."

**AI-suggestion for `categories` in `business-onboarding-assistant` — also DONE (2026-09-10),
same session, direct user follow-up ("finish what you didn't start").** Mirrors subcategory's own
AI-suggestion precedent: `classifyBusinessDescription()` now also extracts a best-effort
`categories` array, validated against the full 75-tag vocabulary and de-duped against whatever
`subcategory` it also picked (avoids double-counting the same real signal across
`subcategoryBonus()`/`secondaryCategoryBonus()`). Wired into `BusinessPartnerApplyScreen.js`'s
existing manual chip picker + AI-summary banner. Redeployed and verified live.

**Cross-category "Experiences" assembly, first increment — fully DONE (2026-09-10), same session,
per direct user "finish what you didn't start" + detailed design guidance given verbatim when
asked to pick a scope via `AskUserQuestion`.** An extensible, data-driven "recommendation recipe"
framework — `experienceTemplates.js` names, per real already-extracted `occasion`
(date_night/anniversary/birthday/celebration/family_gathering), an ordered list of components
(e.g. 🍽️ Dinner → 🎵 Something to Do → 🍰 Finish the Night), each keyed to real leaf-tag categories
from the existing 75-tag vocabulary. `assembleExperience()` (`experienceAssembly.js`) is a PURE,
client-side regrouping of `resolveIntent()`'s own already-fetched, already-scored
`business_availability` candidates — same "regroup what's already real, nothing new fetched or
computed" shape `HomeScreen.js`'s own `groupIntentResultsByType()` already uses. A component with
no genuine match is silently dropped, never forced — a recipe, not a rigid itinerary; nothing is
ever invented. Wired inline into the existing ask-box result flow (`HomeScreen.js`) as a new
section above the flat list, with claimed items filtered out of that flat list so nothing repeats.
Jest coverage added (8 tests, `experienceAssembly.test.js`); full suite 230/230 passing. Full
build/verification detail: `CLAUDE_HISTORY.md`, search "Experiences assembly." This was the last
fully-unstarted piece of the intent-engine vision — both deferred pieces named at the top of this
session (this, and the `categories` AI-suggestion above) are now shipped.

**Both of this increment's own deliberately-deferred pieces — fully DONE (2026-09-10), same day,
direct user follow-up ("finish business side experience bundles and extending the assembly beyond
business_availability").** (1) `assembleExperience()` now also includes real `gathering`
candidates, not just `business_availability` — `resolveGatherings()` (`intentResolver.js`) carries
the gathering's own real `interest_tag` as `category` onto its candidate object, the exact same
field shape `resolveBusinessAvailability`'s candidates already carry, so a genuinely matching
gathering (e.g. a live-music gathering filling "Something to Do") now fills a component
identically to a business posting — `community`/`perk`/etc. still carry no such field and remain
excluded, a real, not-yet-done, separate follow-up. (2) Business-side Experience Bundles: a
business can now explicitly self-declare, on ONE of its own live `business_availability`
postings, that it covers MULTIPLE components of one specific occasion's template all by itself
(e.g. a restaurant's own "Date Night Package" bundling dinner + live music + dessert) — two new
columns (`bundle_occasion`, `bundle_components`), both business-typed with no AI involved,
validated against a flat CHECK vocabulary (union of every template's component keys, interpreted
contextually per-occasion at read time, same precedent `brand_partners.categories`/`attributes`
already set) plus matching validation in `post_business_availability` (now 11 args — old 9-arg
signature explicitly dropped per this repo's own overload-trap convention) and in
`admin_review_business_content_screening`'s MEDIUM/UNCERTAIN raw-insert branch (the *other* write
path into this table — confirmed via `pg_get_functiondef` this is the only other one).
`search_active_business_availability` (4th column-list change now, same drop-first discipline)
returns both new fields; `resolveBusinessAvailability` carries them as
`bundleOccasion`/`bundleComponents` on the candidate. `experienceAssembly.js`'s
`assembleExperience()` pulls a genuine bundle (bundleOccasion matches the ask's own occasion AND
at least 2 of that occasion's own real component keys are covered) out and claims it as one whole
unit *before* the normal per-component loop runs, so it's presented as its own "✨ One place has
it all" unit (`HomeScreen.js`) rather than competing for a single component slot; a posting that
only ticked one box is just a normal single-component candidate, no special casing needed.
Migration `20260929_business_experience_bundles.sql` — schema, all three functions, and every
CHECK constraint verified live against production inside rolled-back transactions (valid bundle
insert + both admin-approve and low-tier RPC write paths + all three invalid-input rejections:
bad occasion, bad component, components-without-occasion). `screen-business-content` Edge
Function redeployed and confirmed live via the Management API's function-body endpoint (new
vocabulary strings present in the deployed bundle) — its own body-parsing glue was verified by
code review + bundle-content confirmation, not exercised via a live authenticated HTTP call (no
test user session available this session). Business owner picks the bundle occasion + components
via new chip pickers in `BusinessDashboardScreen.js`'s existing "Post Availability" modal, entirely
optional, resets cleanly if the occasion is changed. Jest suite extended to 14 tests
(`experienceAssembly.test.js`); full suite 236/236 passing. Deliberately NOT built: Signature
Experiences (`business_experiences` — a different, older, single-category showcase concept never
wired into the intent resolver at all) gaining its own bundle concept — out of scope, not implied
by this change.

**Crossed Paths sighting push notification — fully DONE (2026-09-11).** Item 12 of the Sep 6 2026
external UX critique's last open piece: a genuine sighting now sends a real push to both people in
the pair (each gated on their own new `notify_crossed_paths` preference, default on), deep-linking
to the other person's profile. Shipped as `notify_sighting_crossed_paths()`, a plain `AFTER INSERT`
trigger on `sightings` (`20261002_crossed_paths_sighting_notification.sql`) — the same direct-
table-trigger shape every sibling `notify_*` push in this codebase already uses (there is no
`notification_events` intermediate table anywhere in this schema, confirmed live). Dedup comes free
from `sightings`' own real shape (`UNIQUE(user_a, user_b)` + `report-presence`'s upsert never
touching `first_seen_at` on conflict, confirmed by reading the real deployed Edge Function body) —
a repeated sighting between the same pair is always an `UPDATE`, which an insert-only trigger never
fires on, so no extra dedup column was needed. Verified live via a disposable rolled-back
transaction (genuine push logged once, correctly gated per-recipient, then a re-upsert of the same
pair produced no second push). Client: `notifications.js` routes the new `crossed_paths_sighting`
type to `ViewProfile`; `SettingsScreen.js` has a new "👋 Crossed Paths" toggle. Full Jest suite
252/252 passing; real device push delivery not exercised (no simulator/device tooling available in
this project, standing note). Full research trail and design reasoning: `CLAUDE_HISTORY.md`,
search "Crossed Paths sighting push notification."

**Quick Filters customization copy — Crossed Paths "keep the app open" wording fixed, DONE
(2026-09-06), external UX critique item 12.** Real background location detection already exists
(`startBackgroundPresenceReporting`, a registered background task, started on login in
`RootNavigator.js`) — "keep the app open" was outdated, unnecessarily discouraging friction. Both
`discovery.emptyText` and `discovery.radiusInfoText` (`src/i18n/translations.js`, all 11 locales)
reworded to state what's actually true: no need to keep the app open, background checking exists,
but — per the backlog item above — the copy stops short of promising a push notification, since
none exists yet.

**Branded loading treatment — DONE (2026-09-06), external UX critique item 13.** New
`src/components/BrandedLoader.js` (the app's real splash mark + a subtle coral sweep, not a
generic spinner) now replaces `RootNavigator.js`'s session/profile boot gate, which used to be a
bare `return null` (a blank screen) — the one loading moment every app open passes through.
Deliberately scoped to that one spot rather than replacing all 16 existing `SkeletonCard` call
sites — those are still the right treatment for in-list "more items loading," per direct user
steer not to use the branded treatment everywhere.

**Quick Filters real customization (select + set values + reorder) — fully DONE (2026-09-06),
external UX critique item 9.** Dating's Customize screen used to only reorder/show-hide a fixed 3
booleans; now a shared catalog (`src/constants/quickFilterCatalog.js`) + one generic
`QuickFilterCustomizeScreen` (mode-driven) gives Dating a real settable Match % threshold plus a
new Shared Interests filter, and gives Friends its own first-time Customize affordance over its 4
real dimensions. Migration `20260921_quick_filter_customization.sql` applied and verified live.
Not tested in a running app (no simulator tooling available this session). Full build detail:
`CLAUDE_HISTORY.md`, search "Quick Filters: real select+set-values+reorder customization." The
same critique's items 10 (Messages button visual weight) and 11 (People→Dating/Friends
hierarchy) were both found already fully shipped by prior Aug 23/30 2026 work — no code change
needed for those two.

**Discover/People-Friends parity plan — fully DONE (2026-09-06).** All 4 items (Discover mode
filters in-place, Friends mode mirrors Dating's architecture, Add Friend bug, generalized "Plan
Something" flow) shipped. Full build/verification detail: `CLAUDE_HISTORY.md`, search "Discover/
People-Friends parity plan." **Follow-up fix, 2026-09-10**: the Add Friend bug's original fix
(real friendship-status lookup + Friends ✓/Message/Plan Something rendering) was correct but had
one remaining gap — `ViewProfileScreen.js` used a plain `useEffect(load, [])`, so revisiting an
already-mounted `ViewProfile` route (React Navigation reuses rather than remounts it — e.g.
profile → Chat → that same person's profile again via the chat header) never re-ran `load()`,
leaving `friendshipStatus`/`matchId` frozen at whatever they were on first mount. Switched to
`useFocusEffect` (this codebase's own established pattern) so it's always freshly read on every
focus. See `src/screens/ViewProfileScreen.js`'s own comment at the fix site for the full account.

**Host cancellation lifecycle for Communities and Gatherings — fully DONE (2026-09-06).** Both
items shipped: Communities got a real `status` column (active/paused/cancelled) with a "Manage
Community" section (Edit / Pause-Resume / Cancel / Delete-Permanently-once-cancelled); Gatherings
kept their delete-based mechanism but gained a `cancel_gathering` RPC and a "Cancel Gathering"
action in the detail screen that was previously missing entirely. Verified live against
production with disposable test data. Full build/verification detail: `CLAUDE_HISTORY.md`, search
"Host cancellation lifecycle." **2026-09-10 parity follow-up**: user re-asked for this exact spec
verbatim (unaware it had already shipped); confirmed still live and correct on re-read (including
that gathering cancellation fires a real push via `notify_gathering_cancelled()`, not just a DB
row), then closed the one real cosmetic gap — `GatheringDetailScreen.js`'s Edit/Cancel links now
sit under their own "Manage Gathering" label (new `manageSectionLabel` style, mirroring
Communities' own "Manage Community" label) instead of loose inside the general host banner.

**Phase 8 (Discover visual hierarchy + expand-in-place) is fully DONE, including section H.**
Full account moved to `CLAUDE_HISTORY.md` ("Phase 8 ... section H — BUILT").
"Business Web as an Operating System" (Phases 1-7) is fully DONE. Phases 1-6 (decline reasons,
day-of-week availability, offer-performance funnel, media-on-offer
upload, weather digest card, Requests→Opportunities rename) were verified live in production —
see `CLAUDE_HISTORY.md`, search "Business Web as an Operating System" for the full plan/audit and
each phase's build/verification detail. **Phase 7** (Path A: Expo web export of the existing
business dashboard, reusing RN screens verbatim, deployed as a static site at
`/Nearby/business/` via GitHub Pages from the committed `docs/business/` folder) landed
2026-09-05 — `App.web.js` / `BusinessWebNavigator.js` / `BusinessWebHomeScreen.js` /
`PlatformDateTimeInput.js` are the new web-only surface; `BusinessDashboardScreen.js` and
`businessFulfillment.js` gained `Platform.OS === 'web'` branches for the handful of native-only
actions (camera Moments, Stripe Connect OAuth return, native DateTimePicker, native file upload,
Share.share, GatheringDetail/CommunityDetail navigation) with honest fallback messages/behavior
rather than silent failure. Verified: `expo export -p web` builds clean, output serves correctly
under the `/Nearby/business/` base path via a local static server, no secrets in the built
bundle. **Not verified in an actual browser** — no browser/simulator tooling was available in
that session; if something looks visually off on the deployed site, that's the first thing to
suspect. `docs/business/` must be regenerated (`NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business npx
expo export -p web`, then copy `dist/*` over it) and recommitted any time a business-facing
screen changes — it is not auto-built by CI (no GitHub Actions workflow exists for this yet).

**2026-09-05 fix**: `experiments.baseUrl` was originally a static value in `app.json`, which is a
*global* Expo config field, not web-scoped — `@expo/cli`'s asset-copying code applies it to every
platform's build, not just web. This broke native iOS archive builds (`ENOTDIR` copying assets
into a bogus `Nearby.app/Nearby/business/assets/...` path during "Bundle React Native code and
images"). Fixed by moving config to `app.config.js`, which only injects `experiments.baseUrl`
when the `NEARBY_WEB_EXPORT_BASE_URL` env var is set — i.e. only during the docs/business export
command above, never during a native EAS build. Do not put `baseUrl` back into `app.json` as a
static value.

## Standing Conventions (Locked)

These are the load-bearing rules distilled from thousands of lines of prior build history. Full
original reasoning/citations for any of these: `CLAUDE_HISTORY.md`.

- **No invented numbers, no fabricated signals, ever.** Every metric/count/reason shown anywhere
  in the app must trace to a real query result. An absent signal renders as an honest empty
  state, never a guessed placeholder.
- **No dead ends (Item 56, locked 2026-09-12).** No major surface's empty state may be
  unactionable "nothing here" copy alone — it must offer a concrete, tappable next step to a real
  existing destination (create/adjust-filters/invite/explore-elsewhere, whichever genuinely fits),
  never a fabricated one. Applies to any new empty state a future change introduces, not just the
  surfaces already audited under Items 25/26/56.
- **Coral (`colors.primary`) = action, not decoration.** Tappable-and-advances-the-user → coral.
  Informational → must not visually impersonate a button. Destructive → `colors.danger`, never
  coral. Progress/data-visualization (a fill bar, an achievement indicator) → coral is fine when
  clearly non-interactive. Secondary actions (Cancel, dismiss) → neutral/outlined; coral is
  reserved for a surface's *primary* action. This visual system is frozen — no further
  consistency sweeps expected unless new work introduces a genuinely new pattern.
- **No stranger discovery via intent, ever — hard privacy rule.** Any "find things for you"
  resolver-shaped feature (Home's intent box, Business Fulfillment matching, group-intent
  signals, etc.) may only ever surface real supply (gatherings/communities/businesses) or people
  the caller is already connected to (accepted friend or match) — never proximity/interest-based
  surfacing of an unconnected stranger. Businesses are deliberately exempt (they're discoverable
  supply by design, not a privacy concern the way a person is).
- **AI never infers or assigns a specific date/time from free text.** A user always picks
  date/time through deterministic UI (preset buttons + a picker). AI may suggest title/category/
  location/description for confirmation, never silently commit a date/time guess.
- **AI suggests, never silently commits.** Every AI-derived value anywhere in the app is shown
  back for the user's own explicit confirmation before it's saved — this holds for every
  AI-classification feature in this codebase, no exceptions.
- **Each actor only ever reports its own side's state.** A business says "I accept this Request"
  (→ becomes an Offer); a consumer says "I accept the Offer" (→ becomes a Commitment); Nearby's
  own SECURITY DEFINER RPCs compute the combined/derived state. No client ever directly flips
  another party's state.
- **Decline reasons feed a real, owner-visible insight surface — never automated re-weighting of
  the matching engine.** A business owner sees their own decline pattern and can manually tighten
  their own settings in response; nothing auto-adjusts matching behavior from decline history
  without its own separate, explicit authorization.
- **"Don't navigate for information, navigate for tasks"** (the Progressive Depth doctrine,
  locked Sep 15 2026 as a standing rule for all future UI work): a screen change should only ever
  happen when the user's actual task changes, or real information depth genuinely requires it —
  never merely because a filter, category, or already-visible data changed.
- **Feature-freeze convention**: don't start a new product surface or architectural change
  without a direct, explicit user request. This does not block bug fixes, security fixes, or
  stabilization work — those are always in scope. A direct request is always sufficient to
  proceed on something bigger; this has been explicitly invoked and overridden dozens of times
  since it was first declared (2026-08-15) and is really just describing normal operating mode.
- **Real external accounts / real money (Stripe, a real reservation/transportation provider,
  etc.) always need the user present for that decision** — never set up or connected
  autonomously, even if the schema/UI scaffolding around the seam is otherwise safe to build
  ahead of time.
- **Migration/verification discipline**: one migration file per schema change (never a
  duplicate hand-patch baked into a squashed baseline file in the same change — that exact
  mistake once broke this repo's own "rebuildable from an empty database" guarantee). Verify a
  schema change live against production with real disposable test data before considering it
  done; a full from-scratch Docker replay (`supabase/postgres:15.1.0.147`, drop/recreate an empty
  `public` schema, patch the two known image-version gaps — `auth.users.phone`,
  `storage.buckets.public` — onto the test container only, run the full `supabase/migrations/`
  folder in filename order via `psql -v ON_ERROR_STOP=1`) is the gold-standard extra proof this
  repo has historically done, but isn't mandatory for every small change — disclose plainly
  whether it was done, don't silently skip and claim parity.
- **`CREATE OR REPLACE FUNCTION` creates a second overload instead of replacing the original
  whenever the parameter list changes at all — even with an unchanged return type**, not only
  the already-documented RETURNS TABLE column-list case. Adding a new trailing default
  parameter to an existing function (discovered 2026-09-06 adding `update_business_profile`'s
  `subcategory_param`) leaves the old signature live and independently callable side by side
  with the new one, silently defeating the change for any caller still resolving to the old
  overload. Always re-check `pg_get_function_identity_arguments` for the function name right
  after any such migration; if more than one row comes back, `drop function` the old exact
  signature explicitly, and add that same explicit drop into the migration file itself before
  its `create or replace` so a from-scratch replay lands in the same single-overload state.
- **A new Postgres function defaults to PUBLIC execute access** — always explicitly
  `revoke ... from public, anon` unless it's genuinely meant to be public. Rate-limit/counter
  triggers use `SELECT ... FOR UPDATE` to avoid race conditions. Privileged `profiles` columns
  (`is_premium`, `managed_partner_id`, daily-counter columns, etc.) are guarded by a
  `prevent_self_premium_edit()`-style trigger; a legitimate server-side write to one of these
  must `perform set_config('app.trusted_update', 'true', true)` first.
- **Git workflow for this repo**: commit and push after each individual phase/increment as it
  lands, not batched at the end — this is this project's own long-standing, explicitly
  pre-authorized convention (not something to re-confirm each time), specifically so a
  mid-session restart never loses more than one increment's worth of work.
- **Migration filename ordering matters.** Migrations replay in filename lexical order,
  independent of when they were actually written — a new migration that depends on an earlier
  one must sort *after* it by filename, or a from-scratch replay will fail even though production
  (already migrated in real chronological order) looks fine. This has bitten this repo more than
  once; double-check filename ordering against real dependencies before naming a new migration.

## Reference

- `CLAUDE_HISTORY.md` — the complete historical build log (pre-2026-09-17), unedited, reverse-
  chronological. Grep by date or feature name.
- `PRODUCT_AUDIT/` — standalone audit documents from past sessions, mostly historical snapshots.
  `PRODUCTION_ARCHITECTURE_2026-08-15.md` (system-wide architecture reference) and
  `SIGNAL_CONTRACT.md` (per-signal collection/matching/ranking contract) are the two most likely
  to still be useful as a reference rather than pure history.
- No automated test framework beyond Jest unit tests on pure functions
  (`jest.config.js`/`jest.babel.config.js`) — no simulator/device testing has ever been available
  in any session on this project.
