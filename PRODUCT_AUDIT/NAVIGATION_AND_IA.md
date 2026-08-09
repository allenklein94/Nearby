# Navigation & Information Architecture — Nearby

*Basis: full read of `src/navigation/RootNavigator.js` (the only navigator file in the repo —
there is no secondary navigator anywhere else) plus a repo-wide grep of every
`navigation.navigate(...)` / `.replace(...)` / `.push(...)` call to confirm real entry points
into each stack screen. All route names below are the literal `name=` strings React Navigation
uses, not invented labels. **Refreshed 2026-08-09** against the current repo (21 commits since
the original 2026-08-08 pass) — see `AUDIT_CHANGELOG.md` for what specifically changed.*

## Top-level structure

`RootNavigator` renders exactly one `NavigationContainer` wrapping one `Stack.Navigator`. Which
screens exist in that stack depends on auth state, evaluated once at the top:

- **Not signed in** (`!session`): `Onboarding` → `OnboardingQuestions` → `OnboardingLocation` →
  `Login`. Only these 4 screens exist in the tree; nothing else is reachable.
- **Signed in, profile incomplete** (`session && !profileComplete`): only `CompleteProfile`
  exists in the tree. This is a hard gate — a user cannot reach any other screen (including
  Settings/Legal/Logout) until their profile is complete, which is a real, deliberate
  constraint worth knowing about (see `UX_GAPS.md`).
- **Signed in, profile complete**: the full stack described below, headed by `MainTabs` (the
  5-tab bottom navigator) as the stack's initial/home screen. The full stack now has **~72
  `Stack.Screen` entries**, up from the original audit's "~57" — the two new routes are
  `RelationshipHub` and `BusinessAIAssistant` (both new since the last audit; the rest of the
  growth is the original audit having under-counted, not new screens shipping in between).

There is no drawer navigation, no nested tab-within-tab, and no secondary bottom bar anywhere —
one flat bottom tab bar, with every other screen reached via stack push from either a tab
screen or another stack screen. Unchanged since the last audit.

**Deep linking**: exactly one URL pattern is wired (`nearby://gathering/:gatheringId` →
`GatheringDetail`), scoped deliberately narrow per the in-repo history. **Unchanged since the
last audit** — no new deep link was added, even though `CommunityDetail`/`BusinessProfile`/the
consolidated `RelationshipHub` would all plausibly benefit from one (see `UX_GAPS.md`).

## The 5 bottom tabs

### 1. Home (route: `Home`, tab label "Home")
- **Purpose**: personalized daily dashboard / entry ramp into everything else.
- **Screen**: `HomeScreen.js` only — the tab itself has no sub-screens; everything it surfaces
  is a card/button that pushes into the shared stack (gatherings, communities, quick-create,
  etc.).
- **Content shown**: a best-pick gathering recommendation, "happening now" gatherings,
  time-of-day-aware quick-action chips, a pending-invites banner, "continue your communities,"
  weekly recap/streak framing, and a one-line derived "insight" sentence (explicitly not an
  LLM call). Unchanged since the last audit.
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
  toggle. Unchanged since the last audit.
- **Links to**: `GatheringDetail`, `CommunityDetail`, `BrandOffers`, `AIConcierge`, `Nearby`
  (the dedicated People-discovery screen, reached via a separate "Meet People" card rather
  than the unified search), `Gatherings`, `Places`.

### 3. Create (route: `Create`, tab label "Create")
- **Purpose**: primary entry point for producing new content — a gathering, a community, or a
  business-partnership request.
- **Screen**: `CreateHubScreen.js` — an icon grid (Coffee/Dinner/Walk/Sports/Movie/Game
  Night/Music/Volunteer/Something Else) plus a de-emphasized secondary row for
  Community/Business actions. Unchanged since the last audit.
- **Actions**: tap a grid icon (routes straight into the gathering wizard, prefilled, skipping
  the "What" step) or "Something Else" (reveals an inline free-text box calling the
  `create-assistant` Edge Function to classify intent).
- **Links to**: `CreateGathering` (with `fromQuickPick`), `CreateCommunity`,
  `RequestBusinessPartner`, `BusinessDashboard` (if the caller already manages a business —
  swapped in for the apply flow), `BusinessPartnerApply`.
- **Note on naming**: this tab and the `CreateGathering` route's own header title ("Host a
  Gathering") use different words for the same action family — still true, see `UX_GAPS.md`.

### 4. Inbox (route: `Matches`, tab label overridden to "Inbox")
- **Purpose**: everything that requires the user's response or attention — messages, requests,
  invites.
- **Screen**: `InboxScreen.js`, which internally tabs across sub-sections (Messages, Invites,
  Activity). Route takes an `initialSection` param used by Home's pending-invites banner to
  deep-link into a specific sub-tab. Unchanged since the last audit.
- **Content shown**: real 1:1 matches/conversations, friend requests, gathering/community
  invites (`social_invites`), and a "Group Chats" chip row.
- **Badge**: the tab shows a live unread/pending count (`getInboxUnreadCount`, polled every 15s
  from `RootNavigator.js` itself). Any of these arriving via a push tap now reliably routes
  even from a fully-closed cold start (new since the last audit — see `AUDIT_CHANGELOG.md`).
- **Links to**: `Chat` (1:1), `GatheringChat`, `CommunityChat`, `GatheringDetail`,
  `CommunityDetail` (via invite accept).
- **Naming note**: unchanged — the tab's route name (`Matches`) still doesn't match its label
  ("Inbox") or its actual scope; `MatchesScreen.js` still exists as the underlying "Messages"
  sub-view, composed inline rather than routed to.

### 5. Profile / "You" (route: `Profile`, tab label overridden to "You")
- **Purpose**: identity + the launch pad for every secondary/account feature.
- **Screen**: `ProfileScreen.js`.
- **Content shown**: identity fields, photo gallery, quick stats, earned stats/achievements,
  connection-goal chips, and a "quick links" column: Timeline, Memory Vault, Insights,
  Momentum, Rewards, Billing, Emergency Contacts — plus, conditionally, a "Switch to Business"
  row. All three of Insights/Momentum/Rewards now have a real outbound CTA where they were
  dead ends at the last audit (see `UX_GAPS.md`).
- **Actions**: edit profile, tap any quick-link row, open Settings (gear icon, not a listed
  quick-link).
- **Links to**: `Timeline`, `MemoryVaultIndex`, `Insights`, `Momentum`, `Rewards`, `Billing`,
  `EmergencyContacts`, `BusinessDashboard` (conditional), `Settings`, `ViewProfile`, and from
  Settings onward: `Legal`, `BlockedUsers`, `IdVerification`, `AdminReports`/
  `AdminBusinessRequests`/`AdminVerification` (admin-only), `Paywall`, `MusicMode`.
  **Changed since the last audit**: Settings' previous 6+ flat "Reflection Tools"/"Emergency
  Kit" rows are now a single "❤️ Relationship" row → the new `RelationshipHub` route, which
  internally links to all 8 match-scoped tools plus the 5 personal ones (see
  `SCREEN_INVENTORY.md`'s `RelationshipHubScreen.js` entry).

## "Business Mode" — not a tab

There is no sixth tab and no separate business-mode app shell. A business owner uses the exact
same 5 tabs as everyone else; the only difference is a `managed_partner_id` on their `profiles`
row, which conditionally reveals a "Switch to Business"/"Manage Your Business" entry point in
**two independent places** (`ProfileScreen.js` and `SettingsScreen.js`) that both push into the
same `BusinessDashboard` route. There is a third, separate "Partner With Us" surface
(`BusinessPartnerApplyScreen`, reached from `Create`) for a business that isn't in the app yet
at all. `BusinessDashboard` itself re-resolves the caller's own managed partner on every mount,
so navigating there directly with no business shows a real empty state rather than leaking
data. Unchanged since the last audit — the duplication is still there (see below), and the
dashboard is now meaningfully more complete (self-edit, CRM notes, an AI assistant button) than
it was.

## Duplicate, overlapping, confusing, or missing navigation

- **Two independent "become/manage a business" entry points** (Profile and Settings) still
  duplicate the same conditional logic — unchanged, still a maintenance duplication rather than
  a user-facing bug.
- **`NoticesScreen.js` dead code — RESOLVED.** At the last audit this was "imported but never
  wired to a route." It's now **deleted from the repo entirely** — confirmed via `ls` (file
  does not exist) and via grep (`RootNavigator.js` has zero references to it). The `Notices`
  route continues to correctly render `ActivityScreen.js`, unchanged.
- **The dangling `MatchesScreen` import in `RootNavigator.js` — RESOLVED.** Also confirmed
  removed via grep (zero occurrences of an unused `MatchesScreen` import). The screen itself is
  untouched and still correctly composed directly inside `InboxScreen.js` rather than routed to
  by name — that part of the design is unchanged and was never a bug.
- **Two differently-named "gathering intro" concepts** still live back to back in the stack:
  `GatheringDetail` (pre-join, persuasion) and `GatheringHub` (post-join, live experience) —
  intentional, unchanged, still not obvious from the route table alone.
- **The relationship-longevity screens' navigation is meaningfully improved.** The last audit's
  biggest navigation concern — 6 of 11 relationship tools reachable only through a single
  `ChatScreen.js` `Alert.alert()` — is resolved two ways: (1) the underlying reliability risk
  (a 13-button native Alert) turns out to have already been replaced with a real menu component
  (`ActionSheetModal.js`) at the same commit the original audit was written from, so it was
  never actually live-broken the way the audit worried; (2) discoverability is now real —
  `RelationshipHubScreen.js` (new) plus a single "❤️ Relationship" Settings row gives every one
  of the 11 tools a real, non-Chat-menu entry point. See `SCREEN_INVENTORY.md` and
  `AUDIT_CHANGELOG.md` for detail.
- **Deep linking still covers exactly one route** (`GatheringDetail`). `CommunityDetail`,
  `BusinessProfile`, and `RelationshipHub` still have no shareable link — unchanged from the
  last audit, still a real gap for a screen (`CommunityDetail`) whose own "Invite Friends"
  action could plausibly want one.
- **No settings/nav-level indicator of Business Mode being "on"** — unchanged.
- **New this refresh**: cold-start push-notification taps (`gathering_invite`, `match`,
  `message`, `wave`, `friend_request`, `momentum_streak_nudge`, `reward_tier_nudge`, etc.) that
  arrive while the app is fully closed now correctly route to their destination once the
  authenticated stack mounts, instead of being silently dropped. This mirrors the existing
  `nearby://gathering/:id` deep-link's own pending-navigation pattern, just applied one auth-
  state layer earlier. Verified by direct code reading only (no on-device cold-start push test
  is possible in this sandbox) — see `AUDIT_CHANGELOG.md`.
