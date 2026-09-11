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

### Item 35 — "Why am I here?" audit

(in progress)
