# UX Gaps — Nearby

*Basis: `SCREEN_INVENTORY.md` and `USER_FLOWS.md`, both built from direct code reading. Every
item below traces to a specific file/behavior already documented in those two files, plus a
handful of items independently re-verified firsthand during this pass.*

## Broken flows

- **`ChatScreen.js` ships a production debug overlay.** A condition meant to be dev-only
  (`__DEV__ === undefined ? null : <debug overlay>`) is structurally always false in any real
  build (`__DEV__` is always a boolean, never `undefined`), so a red/yellow debug overlay
  printing internal message state renders on **every message bubble for every real user**, and
  a failed image load shows the literal string `"DEBUG: Image failed to actually render
  (onError fired)"` instead of a normal error. Independently re-verified in this pass.
- **`PlacesScreen.js`'s empty state never renders.** `ListEmptyComponent` is accidentally split
  across a line break into two meaningless JSX props. A category with zero real results shows a
  blank list instead of "Nothing found nearby in this category." Independently re-verified.
- **`OnboardingRecommendationsScreen.js`'s recommendation cards are non-functional as
  recommendations.** Every card's `onPress` navigates to `MainTabs` regardless of which
  gathering's `id` was tapped — the personalization the screen visually promises doesn't
  actually route anywhere specific. Independently re-verified.
- **4 different chat-style screens silently drop a message on send failure** (`ChatScreen`,
  `CommunityChatScreen`, `GatheringChatScreen`, `BusinessConversationScreen`): the composer is
  cleared before the network call resolves, and a failure is swallowed with no visible error,
  retry, or restored draft text.

## Dead ends

- **`InsightsScreen.js`, `MomentumScreen.js`, `RewardsScreen.js`** are all real, well-built,
  data-honest dashboards with **zero outbound CTA** — a user who sees "0 gatherings this month"
  on Momentum, or is 2 redemptions from Silver on Rewards, has no button on that screen to act
  on it.
- **`FeaturesOverviewScreen.js`** lists 25+ real features in an expandable reference doc with
  **no tap-to-navigate affordance to any of them** — a genuine missed opportunity given the
  screen's entire purpose is orientation into a large app.
- **`ChemistryDiaryListScreen.js`** has no "+ Add Entry" button or `navigation` prop at all —
  compare its structurally-identical sibling `GoodbyeArchiveListScreen.js`, which has both. A
  user browsing their diary list has no way to add a new entry from that screen.

## Missing CTAs

(Overlaps with "Dead ends" above — see those three stat screens and the diary-list gap.)
Additionally: **`GatheringDetailScreen`'s pending host-approval state has no visible "withdraw
my request" action** per `USER_FLOWS.md` flow C — only an *approved* attendee can leave via
`leave_gathering()`.

## Duplicate functionality

- **Two near-identically-named business-partnership flows**: `BusinessPartnerApplyScreen`
  ("Partner With Us" — a generic, app-wide "onboard as a partner" application) and
  `RequestBusinessPartnerScreen` ("Request a Business Partner" — a specific gathering/
  community sponsorship ask). Both real, both needed, but the naming makes it genuinely hard to
  tell them apart from a route name or a button label alone.
- **Two "invite" systems that share only a word**: `social_invites` (gathering/community
  invites, friends-only) and the app-referral code system (`InviteFriendsScreen.js`, Settings)
  — a user or a future developer could reasonably conflate these.
- **Two independent, duplicated "is this user a business owner" checks** — `ProfileScreen.js`
  and `SettingsScreen.js` each separately read `profiles.managed_partner_id` to decide whether
  to show a business-dashboard entry point, rather than one owning the check.

## Confusing terminology

- **`TimelineScreen` vs. `TimelinePlannerScreen`** — completely unrelated features (personal
  activity history vs. per-match relationship-pacing notes) with confusingly similar route
  names and screen titles.
- **The `Matches` route/tab is labeled "Inbox"** and actually renders `InboxScreen` (a merge of
  messages/requests/invites/activity), while a separate file literally named `MatchesScreen.js`
  exists and is composed inside it — three related-but-distinct names (`Matches` the route,
  "Inbox" the label, `MatchesScreen.js` the file) for adjacent-but-different things.
- **The `Create` tab and the `CreateGathering` route's header title ("Host a Gathering")** use
  different words for the same action family — minor, but a small consistency gap in an app
  that is otherwise careful about copy (per `CLAUDE.md`'s repeated attention to exact button text).
- **`GatheringDetail` vs. `GatheringHub`** — a deliberate, well-reasoned split (pre-join
  persuasion vs. post-join live experience) but the naming alone doesn't communicate that split
  to someone reading the route table for the first time.

## Screens that do too much

- **`GatheringsScreen.js` (1421 lines) and `ChatScreen.js`** are both large, single-file
  screens carrying substantial business logic directly in the component — three tabs, list/map
  toggle, multiple filter dimensions, and host-management actions all in one file for
  `GatheringsScreen`; a dozen-plus messaging modalities and the entire relationship-tools
  launch menu in one file for `ChatScreen`. Not a functional defect by itself, but both are
  large enough that the debug-overlay bug in `ChatScreen` plausibly went unnoticed *because*
  the file is that large.
- **`SettingsScreen.js`** is the single largest navigational hub in the app (see
  `NAVIGATION_AND_IA.md`) — appearance, language, notifications, privacy, phone change, data
  export, sign-out/delete, plus links to ~20 other screens. Functionally fine, but it is
  overloaded relative to its name ("Settings" undersells how much of the app's secondary
  surface lives only here).

## Screens that don't do enough

- **`BusinessDashboardScreen.js`'s "Business" tab** admits editing the business's own
  name/description/logo isn't built — a real gap in what should be the owner's primary control
  surface, honestly labeled rather than silently missing (a positive, but still a real gap).
- **`OnboardingLocationScreen.js`** collects a real choice (near me/around my city/traveling)
  that is then discarded and never used by anything downstream.
- **`EditGatheringScreen.js`** deliberately can't touch location, visibility, or recurrence —
  by explicit design, but it means a host must delete-and-recreate a gathering for a meaningful
  subset of realistic edits (e.g. "actually, let's make this friends-only instead of public").

## Features that exist but aren't discoverable

This is the single largest, most systemic UX gap found in this audit: **6 of 11
relationship-longevity screens are reachable only through one `Alert.alert()` inside
`ChatScreen.js`** — `RelationshipConstitution`, `StressTest`, `SharedDecisions`,
`SharedPlaylist`, `TripPlanning`, `TimelinePlanner`, plus the write-side of
`RelationshipLegacy` and direct `MemoryVault` access. None of these appear in `SettingsScreen.js`
even though 5 of their thematic siblings (Rehearsal Room, Chemistry Diary, Goodbye Archive,
Legacy Library, Emergency Kit) do — the pattern for surfacing these tools from Settings clearly
exists and is used for less than half of them.

**This has a real reliability dimension, not just a discoverability one**: the menu in question
passes **13 button options to a single `Alert.alert()` call** (independently counted in this
pass). React Native's `Alert.alert` API is documented as supporting up to 3 buttons reliably on
Android; behavior beyond that is undocumented/inconsistent per-platform. This means a
meaningful fraction of this app's most differentiated feature set (see `PRODUCT_OVERVIEW.md`'s
"major differentiators") may be **functionally difficult or impossible for Android users to
even open**, not merely hard to find — this should be treated as a candidate P0/P1 issue
pending an actual device test (see `CRITICAL_MISSING_FEATURES.md` and `PRODUCT_RISKS.md`).

## Features referenced in UI but not implemented

- None found at the level this audit could check (no dangling "Coming Soon" labels or disabled
  buttons pointing at nonexistent routes were observed in the two full screen-inventory passes).
  The closest match is `BusinessDashboardScreen`'s honestly-labeled unbuilt editing tab, already
  covered above — but that's an admitted gap, not a silently-broken reference.

## Features implemented but not surfaced

- Same list as "Features that exist but aren't discoverable" above (relationship-longevity
  cluster) — genuinely complete, working code with no UI path to it beyond one buried menu.
- **`NoticesScreen.js`** is a complete, working, Premium-gated "who noticed you" screen that is
  entirely unreachable (superseded by `ActivityScreen.js`, but never removed) — implemented,
  literally not surfaced anywhere, not even accidentally.
