# Discover/People/Create/Plan UX Coherence Pass — Thursday plan items 34 & 35

Status: IN PROGRESS, started 2026-09-11.

## System-level goal (user's own framing, verbatim)

> We need to perform a Discover/People/Create/Plan UX coherence pass. Do not simply patch
> individual screens. Identify duplicated navigation, inconsistent state handling, disconnected
> flows, dead ends, inconsistent terminology, and places where the user is moved to a new screen
> unnecessarily. Preserve existing functionality while consolidating the experience into coherent
> state-driven surfaces.

Nearby doesn't need more screens. It needs better connected screens. Items 34 and 35 below are
the lens applied to every major screen while running that pass — not two more isolated tickets.

## Item 34 — loading states should be contextual

Item 13 (branded loader) shipped 2026-09-06 but only replaced the app-boot blank-screen moment.
This item asks for something different: every "waiting for a real async result" moment should
say what it's actually waiting for — "Finding things nearby…", "Finding people who match…",
"Finding availability…", "Building your options…" — not just a prettier spinner.

## Item 35 — audit every major screen for "Why am I here?"

For every major screen, answer:
1. Why did I arrive here?
2. What am I looking at?
3. What can I do?
4. What happens when I tap the primary action?
5. Can I get somewhere useful if there are no results?
6. Can I return without losing context?
7. Does this screen use the same terminology as the rest of the app?

A screen that can't cleanly answer all 7 needs work.

## Plan

1. Background fork surveys every major screen in Discover/People/Create/Plan against the 7
   questions + item 34's loading-copy check. Fixes contained issues inline (missing contextual
   loading text, dead-end empty states, terminology drift) — same shape as items 25–33.
2. Anything that looks like a real duplicated-navigation/architecture consolidation call gets
   reported back with a concrete proposal, not silently restructured.
3. This file gets updated with findings + fix commits as they land.

## Findings / fixes so far

### Item 34 — contextual loading states — DONE

Audited every major Discover/People/Create/Plan screen's loading and in-flight search states.
Most initial full-screen loads already had contextual text (`GatheringDetailScreen` "Loading
gathering...", `CommunitiesScreen` "Loading communities...", `HomeScreen`'s own main load
"Finding what's happening near you..."); dating/friends swipe decks use `SkeletonCard` shape
loaders, a deliberate existing pattern (per CLAUDE.md, "the right treatment for in-list loading")
left untouched. Real gaps found and fixed — bare spinners with no copy, on the exact kind of
moment item 34 called out (the ask-box "Find it"/"Surprise Me" flow, category/search result
fetches, business-availability search):

- `HomeScreen.js` — ask-box intent resolution (`intentThinking`) and Surprise Me
  (`surpriseLoading`) now show "Finding things nearby…" / "Building your options…" below the ask
  box instead of resolving silently after the button's own tiny spinner.
- `DiscoverHubScreen.js` — 6 bare `ActivityIndicator`s given real contextual captions: category
  context places ("Finding places nearby…"), the default Things-To-Do landing load ("Finding
  things nearby…"), Gatherings/Communities/Perks search-in-progress ("Searching gatherings/
  communities/perks…"), People-mode Places load ("Finding places nearby…").
- `FriendDiscoveryScreen.js` — initial load now says "Finding people who match…" in Browse mode
  or "Finding people you've crossed paths with…" in Crossed Paths mode (mode-aware, since the
  screen genuinely fetches two different things per the unified Crossed Paths work).
  New `loadingCaption` style added.
- `GatheringsScreen.js` — search-in-progress spinner now says "Searching gatherings…"; the
  existing `gatherings.loadingText` i18n key (`'Loading...'`, generic, used on initial load) was
  reworded to "Finding what's happening nearby…" across **all 11 locales** (en/es/de/fr/pt/ht/zh/
  vi/tl/ru/ko), matching the screen's own "Happening Nearby" framing in each language.
- `PlacesScreen.js` — initial load now says "Finding places nearby…".
- `CommunityDetailScreen.js` — initial load now says "Loading community…" (was bare).
- `CreateGatheringScreen.js` — the "Choose a Place" popular-places loader now says "Finding
  places nearby…". (Left the much smaller "loading my communities" dropdown loader as a bare
  spinner — proportionate scope; it's a brief membership-list fetch, not a "the app is thinking"
  moment.)
- `CreateHubScreen.js` — the "What do you have in mind?" AI assistant's button spinner now shows
  "Building your options…" beneath it while thinking.
- `DateProposalScreen.js` — "Find something nearby" business-availability search now shows
  "Finding availability…" while `searchingNearby` (item 34's own example, applied to the real
  search this app already has).

Verified: full Jest suite 280/280 passing; all 10 touched files transform-checked clean via
`@babel/core` + `babel-preset-expo`. Not exercised in a running app (no simulator/device tooling
available this session, standing note).

### Item 35 — "Why am I here?" audit — DONE, no dead-end/duplication bugs found

Ran the 7-question check against every screen in the RootNavigator's Discover/People/Create/Plan
cluster: DiscoverHubScreen, DiscoveryScreen, FriendDiscoveryScreen/FriendDiscoverySwipeCards,
SwipeableDiscoveryCards, GatheringsScreen, GatheringDetailScreen, CommunitiesScreen,
CommunityDetailScreen, PlacesScreen, CreateHubScreen, CreateGatheringScreen, HomeScreen,
MatchesScreen, DateProposalScreen. This cluster has already been through 10+ targeted audits this
month (items 8/9/14/18-26/30-33) that each covered slices of these same 7 questions under
different names (empty-state escape hatches = Q5, relationship-state/verb consistency = Q7,
navigation depth = Q4/duplicated-navigation) — this pass re-verified those are still true by
reading the current code (not re-trusting old notes) and specifically hunted for the one class of
bug those audits' own methodology could miss: **Q6, state lost on return.**

**Q6 check (the ViewProfileScreen-shaped bug class — mounted screen not refreshing/preserving
state on refocus):** every screen in this cluster already uses `useFocusEffect` (not a bare
`useEffect(fn, [])`) for its own data reload, confirmed by direct grep + read, **except**
`PlacesScreen`, `CreateHubScreen`, `CreateGatheringScreen` — all three legitimately don't need it
(Places is a leaf browse screen with no other-party state to go stale; the two Create screens are
forms/wizards where reloading on refocus would be actively wrong — it would either wipe in-
progress input or silently overwrite it). Checked that reload-on-focus calls (`DiscoverHubScreen`,
`GatheringDetailScreen`, etc.) only refresh their own data-fetch state, not unrelated local UI
state (search query, expanded-category context, scroll position) — confirmed by reading each
`load()`/`loadCore()` body. No new instance of the bug class found.

**Q4/duplicated-navigation check:** grepped every `navigation.navigate('DateProposal'|'GroupPlan'
|'MakeAPlan', ...)` call across the whole screens+components tree (7 call sites). All three
routes are used for one single, consistent purpose each with consistent params (DateProposal
always takes `matchId`, GroupPlan always `proposalId`, MakeAPlan always `offerId`/`partnerId`) —
no duplicated/divergent path to the same real action found beyond what items 21/33 already fixed.

**Terminology spot-check beyond items 32/33's own scope:** grepped "Browse"/"Explore" usage across
the cluster (7 hits) — all are generic escape-hatch copy ("Browse Other Categories", "Explore
Things To Do →"), not competing with "Discover" as this app's own named action-verb the way item
33's "Plan" vs "Do Something" collision was. Not a real inconsistency; left as-is.

**Verdict per the 7 questions, all 14 screens:** all answer cleanly. No screen in this cluster
currently dead-ends, silently resets user context on return, or reaches the same real action via
two inconsistent paths. This isn't a surprise given how much of this exact ground items 8-33
already covered — this pass's job was to verify that work actually holds under the specific "why
am I here" lens rather than assume it does, and it does.

**No architecture-level consolidation proposal is being raised.** The system-level goal ("Nearby
doesn't need more screens, it needs better connected screens") is already the explicit, named
design principle behind this cluster's current shape — DiscoverHubScreen's mode/sub-mode/
expand-in-place state (Phase 8), CreateHubScreen's inline "Something Else" assistant, FiltersModal
as an in-place layer rather than a destination (item 19), QuickFilterCustomize as a `presentation:
'modal'` rather than a full push (item 19) — these were all *already* built as state-driven
surfaces in prior sessions specifically to avoid screen proliferation, not organically arrived at.
Nothing found in this pass rises to the level of "these two screens should really be one."
