# Navigation & Information Architecture — Nearby

*Basis: full read of `src/navigation/RootNavigator.js` (the only navigator file in the repo —
there is no secondary navigator anywhere else) plus a repo-wide grep of every
`navigation.navigate(...)` / `.replace(...)` / `.push(...)` call to confirm real entry points
into each stack screen. All route names below are the literal `name=` strings React Navigation
uses, not invented labels.*

## Top-level structure

`RootNavigator` renders exactly one `NavigationContainer` wrapping one `Stack.Navigator`. Which
screens exist in that stack depends on auth state, evaluated once at the top:

- **Not signed in** (`!session`): `Onboarding` → `OnboardingQuestions` → `OnboardingLocation` →
  `Login`. Only these 4 screens exist in the tree; nothing else is reachable.
- **Signed in, profile incomplete** (`session && !profileComplete`): only `CompleteProfile`
  exists in the tree. This is a hard gate — a user cannot reach any other screen (including
  Settings/Legal/Logout) until their profile is complete, which is a real, deliberate
  constraint worth knowing about (see `UX_GAPS.md`).
- **Signed in, profile complete**: the full ~57-screen stack described below, headed by
  `MainTabs` (the 5-tab bottom navigator) as the stack's initial/home screen.

There is no drawer navigation, no nested tab-within-tab, and no secondary bottom bar anywhere —
one flat bottom tab bar, with every other screen reached via stack push from either a tab
screen or another stack screen.

**Deep linking**: exactly one URL pattern is wired (`nearby://gathering/:gatheringId` →
`GatheringDetail`), scoped deliberately narrow per the in-repo history. No other route has a
deep link, including screens that are shared/messaged elsewhere in the app (see `UX_GAPS.md`).

## The 5 bottom tabs

### 1. Home (route: `Home`, tab label "Home")
- **Purpose**: personalized daily dashboard / entry ramp into everything else.
- **Screen**: `HomeScreen.js` only — the tab itself has no sub-screens; everything it surfaces
  is a card/button that pushes into the shared stack (gatherings, communities, quick-create,
  etc.).
- **Content shown** (per its own service, `homeDashboard.js`, cross-checked against the
  `.from()`/`.rpc()` grep): a best-pick gathering recommendation, "happening now" gatherings,
  time-of-day-aware quick-action chips, a pending-invites banner, "continue your communities,"
  weekly recap/streak framing, and a one-line derived "insight" sentence (explicitly not an
  LLM call — a rules-based pick over already-computed signals).
- **Actions**: tap into any surfaced gathering/community, tap a quick-action chip to jump into
  Create prefilled, dismiss/act on the invites banner, open the floating "+ Start Something"
  action.
- **Links to**: `GatheringDetail`, `Gatherings`, `Communities`, `CommunityDetail`,
  `CreateGathering`, `Inbox`(via banner)/`Notices`, `OnboardingRecommendations` (once, right
  after signup only).

### 2. Discover (route: `Discover`, tab label "Discover")
- **Purpose**: the single unified browse/search surface across everything discoverable —
  deliberately excludes people-search (a stalking-vector concern, per the in-repo history).
- **Screen**: `DiscoverHubScreen.js`.
- **Content shown**: unified text search across gatherings/communities/perks (client-side
  filter over already-fetched lists) plus live-queried Places (Google Places API); a
  type-filter chip row (All/Gatherings/Communities/Places/Perks); a Trending section; a
  Recommended-for-you section (signal-based, not LLM); an AI Concierge entry row; list/map
  toggle.
- **Actions**: search, filter by type, switch list/map, tap into any result, tap "Ask AI
  Concierge."
- **Links to**: `GatheringDetail`, `CommunityDetail`, `BrandOffers`, `AIConcierge`, `Nearby`
  (the dedicated People-discovery screen, reached via a separate "Meet People" card rather
  than the unified search), `Gatherings`, `Places`.
- **Note**: the People-discovery flow (`DiscoveryScreen.js`, route `Nearby`) is a full,
  separate swipe-card screen only reachable from this tab's own entry card — it is not a
  sub-tab and has no bottom-bar presence of its own.

### 3. Create (route: `Create`, tab label "Create")
- **Purpose**: primary entry point for producing new content — a gathering, a community, or a
  business-partnership request.
- **Screen**: `CreateHubScreen.js` — an icon grid (Coffee/Dinner/Walk/Sports/Movie/Game
  Night/Music/Volunteer/Something Else) plus a de-emphasized secondary row for
  Community/Business actions.
- **Actions**: tap a grid icon (routes straight into the gathering wizard, prefilled, skipping
  the "What" step) or "Something Else" (reveals an inline free-text box calling the
  `create-assistant` Edge Function to classify intent).
- **Links to**: `CreateGathering` (with `fromQuickPick`), `CreateCommunity`,
  `RequestBusinessPartner`, `BusinessDashboard` (if the caller already manages a business —
  swapped in for the apply flow), `BusinessPartnerApply`.
- **Note on naming**: this tab and the `CreateGathering` route's own header title ("Host a
  Gathering") use different words for the same action family — see `UX_GAPS.md` for the
  broader terminology-consistency note.

### 4. Inbox (route: `Matches`, tab label overridden to "Inbox")
- **Purpose**: everything that requires the user's response or attention — messages, requests,
  invites.
- **Screen**: `InboxScreen.js`, which internally tabs across sub-sections (Messages, Invites,
  Activity per the in-repo history — confirmed the route itself takes an `initialSection`
  param used by Home's pending-invites banner to deep-link into a specific sub-tab).
- **Content shown**: real 1:1 matches/conversations, friend requests, gathering/community
  invites (`social_invites`), and a "Group Chats" chip row (gathering + community chats the
  user belongs to).
- **Badge**: the tab shows a live unread/pending count (`getInboxUnreadCount`, polled every 15s
  from `RootNavigator.js` itself, not from the screen).
- **Links to**: `Chat` (1:1), `GatheringChat`, `CommunityChat`, `GatheringDetail`,
  `CommunityDetail` (via invite accept).
- **Naming note**: the tab's route name (`Matches`) no longer matches its label ("Inbox") or
  its actual scope (far more than dating matches) — purely internal, invisible to users, but
  worth flagging for anyone extending this file, since `MatchesScreen.js` (a different file)
  still exists as the underlying "Messages" sub-view.

### 5. Profile / "You" (route: `Profile`, tab label overridden to "You")
- **Purpose**: identity + the launch pad for every secondary/account feature.
- **Screen**: `ProfileScreen.js`.
- **Content shown**: identity fields, photo gallery, quick stats, earned stats/achievements,
  connection-goal chips, and a long "quick links" column: Timeline, Memory Vault, Insights,
  Momentum, Rewards, Billing, Emergency Contacts (per the in-repo history, the last two were
  added specifically to fix a "buried two taps deep in Settings" gap) — plus, conditionally, a
  "Switch to Business" row.
- **Actions**: edit profile, tap any quick-link row, open Settings (gear icon, not a listed
  quick-link).
- **Links to**: `Timeline`, `MemoryVaultIndex`, `Insights`, `Momentum`, `Rewards`, `Billing`,
  `EmergencyContacts`, `BusinessDashboard` (conditional), `Settings`, `ViewProfile` (self-view
  variant used elsewhere), and from Settings onward: `Legal`, `BlockedUsers`, `IdVerification`,
  `AdminReports`/`AdminBusinessRequests`/`AdminVerification` (admin-only), `Paywall`,
  `MusicMode`, plus every relationship-longevity screen (`ChemistryDiaryList`,
  `GoodbyeArchiveList`, `RelationshipConstitution`, `RelationshipEmergencyKit`,
  `LegacyLibrary`, `StressTest`, `SharedDecisions`, `TripPlanning`, `TimelinePlanner`,
  `RehearsalRoom`, `SharedPlaylist` — see `SCREEN_INVENTORY.md` for which of these are actually
  linked from Settings vs. only reachable from deep inside a specific match's `Chat` screen).

## "Business Mode" — not a tab

There is no sixth tab and no separate business-mode app shell. A business owner uses the exact
same 5 tabs as everyone else; the only difference is a `managed_partner_id` on their `profiles`
row, which conditionally reveals a "Switch to Business"/"Manage Your Business" entry point in
**two independent places** (`ProfileScreen.js` and `SettingsScreen.js`, confirmed both exist
per the in-repo history) that both push into the same `BusinessDashboard` route. There is a
third, separate "Partner With Us" surface (`BusinessPartnerApplyScreen`, reached from `Create`)
for a business that isn't in the app yet at all — this is a generic onboarding application, not
part of the dashboard experience. `BusinessDashboard` itself is not gated by a nav guard beyond
the two entry points being conditionally hidden — it re-resolves the caller's own managed
partner on every mount, so navigating there directly with no business shows a real empty state
rather than leaking data (see `SCREEN_INVENTORY.md`).

## Duplicate, overlapping, confusing, or missing navigation

- **Two independent "become/manage a business" entry points** (Profile and Settings) that
  duplicate the same conditional logic rather than one owning it and the other linking to it —
  functionally fine (both correctly gate on the same flag) but a maintenance duplication.
- **`NoticesScreen.js` is dead**: imported in `RootNavigator.js` but never assigned to any
  `component=` — the `Notices` route (label "Activity") actually renders `ActivityScreen.js`.
  This is either an incomplete rename/replacement or leftover scaffolding; either way it's an
  unreachable screen sitting in the codebase (see `SCREEN_INVENTORY.md`,
  `IMPLEMENTATION_NOTES.md`).
- **Two differently-named "gathering intro" concepts** live back to back in the stack:
  `GatheringDetail` (pre-join, persuasion) and `GatheringHub` (post-join, live experience) —
  intentional per the in-repo history, but the naming (`Detail` vs `Hub`) doesn't make that
  split obvious from the route table alone; a newcomer to the codebase has to read both files
  to know which is which.
- **The relationship-longevity screens' navigation entry points were not independently
  re-verified in this pass beyond what the screen-inventory agents found** — see
  `SCREEN_INVENTORY.md` and `UX_GAPS.md` for the specific finding on whether each is reachable
  from Settings/Profile vs. only from deep inside `ChatScreen.js` for a specific match. If
  several of them are only reachable per-match, a user with a large relationship-tooling
  appetite but only casual matches would have a hard time discovering them at all.
- **Deep linking covers exactly one route** (`GatheringDetail`). `CommunityDetail`,
  `BusinessProfile`, and any of the relationship-tooling screens have no shareable link, even
  though at least `CommunityDetailScreen.js` has its own "Invite Friends" action that could
  plausibly want one (not confirmed to actually construct a link — see `UX_GAPS.md`).
- **No settings/nav-level indicator of Business Mode being "on"** — since it's not a real mode
  switch (just a conditional dashboard link), a user who manages a business sees the exact same
  5 tabs and has no persistent visual cue they're "in" business context versus consumer
  context, unlike apps that visually swap the whole shell.
