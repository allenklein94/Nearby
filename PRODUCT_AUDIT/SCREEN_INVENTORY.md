# Screen Inventory — Nearby

*Basis: every file in `src/screens/` (73 total) was read directly, cross-checked against
`RootNavigator.js`'s actual route wiring and a repo-wide grep of every `navigate()`/`.replace()`/
`.push()` call that targets each route. No screen was skipped. Two screens were independently
re-verified firsthand beyond the initial read (`PlacesScreen.js`, `OnboardingRecommendationsScreen.js`,
`LoginScreen.js`, `ChatScreen.js`'s Alert button count) because their findings were surprising
enough to warrant confirmation before reporting them here.*

## Summary

- **73 screen files** exist in `src/screens/`.
- **71 are reachable** through some real navigation path.
- **2 are not wired to any route at all**: `NoticesScreen.js` (fully dead — a complete,
  superseded "who noticed you" screen) and `MatchesScreen.js` (imported into `RootNavigator.js`
  but never assigned to a `component=` prop there — however the screen itself **is** alive,
  composed directly as a React child inside `InboxScreen.js` rather than routed to by name).
- **~65 are functionally COMPLETE**, several with an honestly-labeled partial gap
  (`EditGathering` can't touch location/visibility/recurrence by design;
  `BusinessDashboard`'s profile-editing tab is admittedly unbuilt; `ChemistryDiaryList` has no
  add-entry affordance unlike its sibling `GoodbyeArchiveList`).
- **A cluster of 6 relationship-longevity screens** (`RelationshipConstitution`, `StressTest`,
  `SharedDecisions`, `SharedPlaylist`, `TripPlanning`, `TimelinePlanner`) plus the write-side of
  `RelationshipLegacy` and direct `MemoryVault` access are complete and working but reachable
  **only** through a single 13-button `Alert.alert()` inside `ChatScreen.js` — no Settings/Profile
  entry point exists for any of them. See `UX_GAPS.md` for the discoverability/reliability
  implications.

Legend: **COMPLETE** = fully working, no missing piece observed · **PARTIAL** = works but has a
real, observed gap (sometimes by explicit design) · **UNUSED-OR-UNREACHABLE** = no live route
reaches it.

---

### AIConciergeScreen.js
- Route: `AIConcierge` · Reached from: `DiscoverHubScreen.js` ("✨ Ask AI Concierge")
- Purpose: free-text "what should I do" query answered by the `ai-concierge` Edge Function
  over real gatherings/communities/perks
- Primary CTA: submit query · Secondary: 4 canned suggestion chips, tap a result
- Data: `askConcierge()` results (typed gathering/community/perk)
- Links to: `GatheringDetail`, `CommunityDetail`, `BrandOffers`
- **Completeness: COMPLETE**

### ActivityScreen.js
- Route: registered as `Notices` (label "Activity") · Reached from: `ActivityBell.js`,
  `services/notifications.js` push-tap routing
- Purpose: unified activity feed — notices/waves, crossed-paths, friend requests, business updates
- Primary CTA: tap a card → relevant profile/business · Secondary: inline accept/decline
  friend requests, notice-back
- Data: `notices`, `blocks`, `matches`, `getNearbyMatches`, `getPendingFriendRequests`,
  `getFollowedBusinessUpdates`
- Links to: `ViewProfile`, `Paywall`, `Matches`, `BusinessProfile`
- **Completeness: COMPLETE**

### AdminBusinessRequestsScreen.js
- Route: `AdminBusinessRequests` · Reached from: `SettingsScreen.js` (admin-only row)
- Purpose: admin review queue for business-partner applications
- Primary CTA: Approve/Deny · Data: `business_partner_requests` + `profiles`
- **Completeness: COMPLETE** — note: Approve goes through `approve_business_partner_request`
  RPC, Deny is a plain client `.update()` — an inconsistency worth a security look (see
  `PRODUCT_RISKS.md`)

### AdminReportsScreen.js
- Route: `AdminReports` · Reached from: `SettingsScreen.js`
- Purpose: moderation queue for user reports
- Primary CTA: "Suspend User" / "Mark Resolved" · Data: `reports` + `profiles`
- **Completeness: COMPLETE** — note: "Suspend" repurposes `profiles.photo_verified = false`
  rather than a dedicated suspension flag/state — an overloaded field, not a separate concept

### AdminVerificationScreen.js
- Route: `AdminVerification` · Reached from: `SettingsScreen.js`
- Purpose: review pending ID-verification submissions
- Primary CTA: Approve/Reject via `admin_approve_id_verification` RPC (atomic, server-side)
- **Completeness: COMPLETE**

### BillingScreen.js
- Route: `Billing` · Reached from: `SettingsScreen.js`, `ProfileScreen.js`
- Purpose: shows current RevenueCat subscription plan/status
- Primary CTA: "Manage Subscription" / "Upgrade to Premium" · Secondary: "Restore Purchases"
- Links to: `Paywall`
- **Completeness: COMPLETE** — Payment Methods/Billing History sections are deliberately
  informational-only (native IAP means Apple/Google hold the real billing history), not broken

### BlockedUsersScreen.js
- Route: `BlockedUsers` · Reached from: `SettingsScreen.js`
- Purpose: list + unblock blocked users · **Completeness: COMPLETE**

### BrandOffersScreen.js
- Route: `BrandOffers` · Reached from: `MatchesScreen.js`, `DiscoverHubScreen.js`,
  `HomeScreen.js`, `GatheringsScreen.js`, `SettingsScreen.js`, `AIConciergeScreen.js`
- Purpose: browse/redeem local perks, with follow/unfollow and unlock-progress indicators
- Links to: `BusinessProfile`, `BusinessConversation`
- **Completeness: COMPLETE**

### BusinessConversationScreen.js
- Route: `BusinessConversation` · Reached from: `BusinessProfileScreen.js`, `BrandOffersScreen.js`
- Purpose: 1:1 DM thread between a user and a business
- **Completeness: COMPLETE**, with a real gap: a failed send is silently swallowed after the
  composer is already cleared — the user's typed message is lost with no error/retry shown
  (same pattern repeats in 3 other chat-style screens, see below)

### BusinessDashboardScreen.js
- Route: `BusinessDashboard` · Reached from: `CreateHubScreen.js`, `SettingsScreen.js` (2 rows),
  `ProfileScreen.js`
- Purpose: full business-owner console — stats, gatherings, community, insights, offers, inbox
- Data: `get_business_dashboard_stats`, `get_business_growth`, `get_gathering_attendee_breakdown`,
  `getBusinessTopMembers`, `getBusinessVisitFrequency`, `getPendingPartnershipRequestsForPartner`,
  `getEstimatedAmountOwed`
- Links to: `BusinessProfile`
- **Completeness: PARTIAL** — the screen's own "Business" tab states outright that editing the
  business profile (name/description/logo) isn't built yet ("contact support to make changes
  for now"). An honestly-labeled but real gap in a screen meant to be the owner's full control panel.

### BusinessPartnerApplyScreen.js
- Route: `BusinessPartnerApply` · Reached from: `SettingsScreen.js`
- Purpose: generic "become a Nearby partner" application for a business not yet in the app
- **Completeness: COMPLETE** — note: near-identically named to `RequestBusinessPartnerScreen`
  ("Partner With Us" vs. "Request a Business Partner"), a real terminology-overlap risk (see
  `UX_GAPS.md`)

### BusinessProfileScreen.js
- Route: `BusinessProfile` · Reached from: very widely linked (`BusinessDashboard`,
  `DiscoverHub`, `GatheringDetail`, `Activity`, `CommunityDetail`, `BrandOffers`,
  `BusinessHostBadge` component)
- Purpose: public business profile — followers, reputation, photos, perks, upcoming gatherings
- Links to: `BusinessConversation`, `GatheringDetail`
- **Completeness: COMPLETE**

### ChatScreen.js
- Route: `Chat` · Reached from: push-tap routing, `MatchesScreen.js`
- Purpose: 1:1 match messaging — text/voice/photo/video/GIF/reactions/translation/disappearing
  messages, plus the "Do Something Together" menu into most relationship-tool screens
- Links to: `ViewProfile`, `SharedPlaylist`, `TripPlanning`, `SharedDecisions`,
  `RelationshipLegacy`, `TimelinePlanner`, `MemoryVault`, `ChemistryDiaryEntry`, `StressTest`,
  `RelationshipConstitution`, `Paywall`, `GoodbyeArchiveEntry`
- **Completeness: PARTIAL — two real, independently-verified bugs**:
  1. A debug overlay condition (`__DEV__ === undefined ? null : <debug text>`) is **always
     false** in any real build (`__DEV__` is always a defined boolean, never `undefined`), so
     the debug branch — a red/yellow overlay printing internal message state — renders on
     **every message bubble in production**.
  2. A failed image load renders the literal string `"DEBUG: Image failed to actually render
     (onError fired)"` directly to end users instead of a normal error message.
  Also shares the silent-send-failure pattern (see below).

### ChemistryDiaryEntryScreen.js
- Route: `ChemistryDiaryEntry` · Reached from: `ChatScreen.js` only ("Do Something Together" menu)
- Purpose: private single-entry "how did that time feel" check-in
- **Completeness: COMPLETE**

### ChemistryDiaryListScreen.js
- Route: `ChemistryDiaryList` · Reached from: `SettingsScreen.js`
- Purpose: lists private chemistry-diary entries; 3+ entries unlocks an aggregate "Your
  Patterns" insight panel
- **Completeness: PARTIAL** — no `navigation` prop and no "+ Add Entry" affordance anywhere on
  the screen; the only way to create a new entry is via `ChatScreen`'s deeply-buried menu.
  Directly comparable to `GoodbyeArchiveListScreen`, an identical "diary list" pattern that
  *does* have a proper add-button + name-prompt modal — this screen is missing that equivalent.

### CommunitiesScreen.js
- Route: `Communities` · Reached from: `DiscoverHubScreen.js`, `ProfileScreen.js`
- Purpose: browse joined + discoverable public communities
- Links to: `CreateCommunity`, `CommunityDetail` · **Completeness: COMPLETE**

### CommunityChatScreen.js
- Route: `CommunityChat` · Reached from: `CommunityDetailScreen.js`
- Purpose: group chat for community members
- **Completeness: COMPLETE**, shares the same silent-send-failure pattern (see below)

### CommunityDetailScreen.js
- Route: `CommunityDetail` · Reached from: `DiscoverHubScreen.js`, `HomeScreen.js`,
  `CommunitiesScreen.js` (×2), `AIConciergeScreen.js`
- Purpose: community landing page — join/leave, member/leader management, gatherings
  (list/calendar), business affiliation
- Links to: `BusinessProfile`, `CommunityChat`, `CreateGathering`, `RequestBusinessPartner`
- **Completeness: COMPLETE**

### CompleteProfileScreen.js
- Route: `CompleteProfile` · Reached from: rendered directly by `RootNavigator` (not `navigate()`'d)
  whenever `session && !profileComplete`
- Purpose: mandatory first-run profile setup (name, 18+ birthdate gate, photo, interests, consent)
- **Completeness: COMPLETE** — this is a hard gate; nothing else in the app is reachable until
  it's finished (see `NAVIGATION_AND_IA.md`)

### CreateCommunityScreen.js
- Route: `CreateCommunity` · Reached from: `CreateHubScreen.js` (×2), `RequestBusinessPartnerScreen.js`,
  `CommunitiesScreen.js`
- Purpose: create a new community · Links to: `CommunityDetail` · **Completeness: COMPLETE**

### CreateGatheringScreen.js
- Route: `CreateGathering` · Reached from: extremely widely used (`CreateHubScreen.js` ×4,
  `HomeScreen.js`, `CommunityDetailScreen.js`, `RequestBusinessPartnerScreen.js`,
  `StartSomethingModal.js` ×3, `GatheringFeedbackModal.js`, `GatheringsScreen.js` ×2)
- Purpose: "Create 2.0" multi-step wizard — What/Who/When/Where/Details/Publish
- Links to: `SelectGatheringLocation`, `GatheringConfirmation`
- **Completeness: COMPLETE**

### CreateHubScreen.js
- Route: rendered as the `Create` tab · Reached from: bottom tab bar only
- Purpose: "Create 2.0" landing hub — icon grid + AI-assisted free-text fallback + secondary
  community/business links
- Links to: `CreateGathering`, `CreateCommunity`, `RequestBusinessPartner`, `BusinessDashboard`
- **Completeness: COMPLETE**

### DiscoverHubScreen.js
- Route: rendered as the `Discover` tab · Reached from: bottom tab bar only
- Purpose: unified cross-content search/browse — gatherings, communities, places, perks,
  map/list toggle, Trending, Recommended-for-you
- Links to: `AIConcierge`, `GatheringDetail`, `BrandOffers`, `BusinessProfile`, `Nearby`,
  `Gatherings`, `CommunityDetail`, `Communities`, `Places`
- **Completeness: COMPLETE** — deliberately excludes People search (documented anti-stalking
  reasoning) and a generic card view (no natural single gesture across 4 content shapes)

### DiscoveryScreen.js
- Route: registered as `Nearby` · Reached from: `DiscoverHubScreen.js`, `HomeScreen.js` (×2)
- Purpose: core "meet people" screen — Crossed Paths vs. Browse, Notice/Wave, list/swipe-card
- Links to: `Paywall`, `ViewProfile`, `QuickFilterCustomize`
- **Completeness: COMPLETE**

### EditGatheringScreen.js
- Route: `EditGathering` · Reached from: `GatheringsScreen.js` (host's Edit action)
- Purpose: edit an already-published gathering's title/description/date/photo/vibe/timeline
- **Completeness: PARTIAL by explicit design** — the screen states up front that location,
  visibility, and recurrence can't be changed here ("cancel and recreate if those need to
  change") — a real, intentional functional limit for hosts, not a bug

### EmergencyContactsScreen.js
- Route: `EmergencyContacts` · Reached from: `SettingsScreen.js`, `ProfileScreen.js`,
  `DateCheckInModal.js` · **Completeness: COMPLETE**

### FeaturesOverviewScreen.js
- Route: `FeaturesOverview` · Reached from: `SettingsScreen.js`
- Purpose: static, expandable "Everything In Nearby" feature reference
- **Completeness: COMPLETE for its stated purpose**, but notable: zero interactive navigation —
  every one of the 25+ listed features is described but none are tappable to jump directly to
  that feature, a missed deep-linking opportunity in a screen whose whole point is orientation

### FriendsScreen.js
- Route: `Friends` · Reached from: `SettingsScreen.js`, `ProfileScreen.js`
- Purpose: manage friends — search, suggestions, contacts-import, requests, custom "Circles"
- Links to: `ViewProfile` · **Completeness: COMPLETE**

### GatheringChatScreen.js
- Route: `GatheringChat` · Reached from: `GatheringDetailScreen.js`, `GatheringHubScreen.js`
  (multiple), `GatheringsScreen.js`
- Purpose: group chat for gathering attendees, plus AI-suggested offers and story posting
- **Completeness: COMPLETE**, shares the silent-send-failure pattern (see below)

### GatheringConfirmationScreen.js
- Route: `GatheringConfirmation` · Reached from: `CreateGatheringScreen.js` (`.replace` on publish)
- Purpose: post-publish success screen — real Share deep link + friend invites with shared-context hints
- Links to: `GatheringDetail` · **Completeness: COMPLETE** — code comments explicitly document
  this replaced a prior dead-end `Alert.alert('Posted!'...)`, and the deep link genuinely works
  (wired into `RootNavigator`'s `linking` config plus an unauthenticated-recipient stash)

### GatheringDetailScreen.js
- Route: `GatheringDetail` · Reached from: extremely widely used (BusinessProfile, DiscoverHub,
  Gatherings, Home, AIConcierge, push-tap routing, GatheringHub, the `nearby://` deep link)
- Purpose: pre-join "can I see myself here" persuasion screen — full details, host reputation,
  attendees, vibe, timeline, Q&A, join/waitlist action
- Links to: `ViewProfile`, `BusinessProfile`, `Gatherings`, `RequestBusinessPartner`,
  `GatheringHub`, `GatheringChat`, `Paywall`
- **Completeness: COMPLETE**

### GatheringHubScreen.js
- Route: `GatheringHub` · Reached from: `GatheringDetailScreen.js` (regular + `.replace` on
  auto-approve), `GatheringsScreen.js`
- Purpose: live "day-of" experience for confirmed attendees — countdown, who you'll meet, ice
  breakers, meetup map, on-my-way/check-in
- Links to: `GatheringDetail`, `GatheringChat`, `ViewProfile`
- **Completeness: COMPLETE** — explicitly, deliberately missing live GPS/ETA tracking and
  GPS-verified arrival (documented as a scoped omission, not a bug)

### GatheringsScreen.js
- Route: `Gatherings` · Reached from: very widely used (DiscoverHub, Home ×5, GatheringDetail,
  Profile, push-tap routing, `GatheringFeedbackModal`)
- Purpose: main gatherings browser — 3 tabs (Nearby/Attending/Hosting), list/map, filters, host
  management (approve/deny, cancel, edit)
- Links to: `CreateGathering`, `BrandOffers`, `GatheringDetail`, `ViewProfile`, `GatheringHub`,
  `EditGathering`, `GatheringChat`, `Paywall`, `Matches`
- **Completeness: COMPLETE** — the single largest, most feature-dense screen in the app
  (1421 lines); a maintainability concern (see `IMPLEMENTATION_NOTES.md`), not a functional gap

### GoodbyeArchiveEntryScreen.js
- Route: `GoodbyeArchiveEntry` · Reached from: `ChatScreen.js` (post-unmatch prompt),
  `GoodbyeArchiveListScreen.js` · **Completeness: COMPLETE**

### GoodbyeArchiveListScreen.js
- Route: `GoodbyeArchiveList` · Reached from: `SettingsScreen.js`
- Purpose: lists private "Goodbye Archive" reflections; proper "Add a Reflection" button + name
  modal → entry screen
- Links to: `GoodbyeArchiveEntry` · **Completeness: COMPLETE** — the correctly-built version of
  the pattern `ChemistryDiaryListScreen` is missing

### HomeScreen.js
- Route: rendered as the `Home` tab · Reached from: bottom tab bar only
- Purpose: the app's front door — greeting, quick actions, happening-now, forecast,
  communities, perks, friends' activity, best-pick, weekly recap, trending
- Links to: `CreateGathering`, `Matches`, `Gatherings`, `CommunityDetail`, `BrandOffers`,
  `ViewProfile`, `Nearby`, `GatheringDetail`
- **Completeness: COMPLETE**

### IdVerificationScreen.js
- Route: `IdVerification` · Reached from: `SettingsScreen.js` · **Completeness: COMPLETE**

### InboxScreen.js
- Route: `Matches` (tab, labeled "Inbox") · Reached from: bottom tab bar; also `ActivityScreen.js`,
  `HomeScreen.js`, `GatheringsScreen.js` navigate here with an `initialSection` param
- Purpose: tabbed hub — Messages (embeds `MatchesScreen`), Requests, Invites, Reminders, Activity
  (embeds `ActivityScreen`)
- Data: `getAllPendingRequests`, `getPendingFriendRequests`, `getMyReceivedInvites`,
  `getUpcomingReminders`, `getMyGatheringChats`/`getMyCommunities`
- Links to: `GatheringDetail`, `CommunityDetail`, `GatheringChat`, `CommunityChat`
- **Completeness: COMPLETE** — explicitly a "thin wrapper" per its own code comment: it embeds
  `MatchesScreen`/`ActivityScreen` as React children rather than navigating to them, which is
  why neither of those two ever appears as an independent route in `RootNavigator.js`

### InsightsScreen.js
- Route: `Insights` · Reached from: `ProfileScreen.js`
- Purpose: read-only personal stats — attendance, hosting, communities, friends, vibe breakdown, achievements
- **Completeness: COMPLETE but a dead end** — zero outbound navigation or CTA to act on
  anything shown (e.g. low attendance doesn't link to "find a gathering")

### InviteFriendsScreen.js
- Route: `InviteFriends` · Reached from: `SettingsScreen.js`
- Purpose: referral program — share code, redeem a code, referral stats
- **Completeness: COMPLETE** — note: hardcoded App Store URL in the share message, a magic
  string outside any config (see `IMPLEMENTATION_NOTES.md`)

### LegacyLibraryScreen.js
- Route: `LegacyLibrary` · Reached from: `SettingsScreen.js`
- Purpose: read-only feed of anonymized relationship-wisdom entries from other users
- **Completeness: COMPLETE as a read surface**, but no CTA prompting the viewer to submit their
  own (that only exists via `ChatScreen`'s buried menu — see `RelationshipLegacyScreen` below)

### LegalScreen.js
- Route: `Legal` · Reached from: `SettingsScreen.js`
- Purpose: static Privacy/Terms/open-source-license info
- **Completeness: COMPLETE** — note: Privacy/Terms links point to a personal GitHub Pages
  domain (`allenklein94.github.io/Nearby/...`) rather than a dedicated production domain

### LoginScreen.js
- Route: `Login` · Reached from: `OnboardingScreen.js`, `OnboardingLocationScreen.js`
- Purpose: phone-number OTP sign-in
- **Completeness: COMPLETE, with a notable finding, independently re-verified firsthand**: a
  hardcoded App Store reviewer bypass (`REVIEWER_PHONE_DIGITS = '5555550199'`) triggers a raw
  `fetch()` (not the shared `services/supabase` client) to a hardcoded Edge Function URL
  (`https://enmosvippabmuqslzrox.supabase.co/functions/v1/review-login`) with a hardcoded
  `Authorization: Bearer sb_publishable_...` key inline in the component. Functionally
  reasonable (App Review needs a way in without a real phone), but the implementation pattern
  (hardcoded URL/key bypassing the shared client) recurs elsewhere too (see
  `IMPLEMENTATION_NOTES.md`).

### MatchesScreen.js
- Route: **none** — imported into `RootNavigator.js` but never assigned to a `component=` prop
  (confirmed: 0 occurrences of `component={MatchesScreen}`). The screen is not dead, though: it
  is rendered directly as a React child inside `InboxScreen.js`'s Messages section.
- Purpose: match list, celebration modal, compatibility badges, post-date safety check-in flow
- Links to: `Chat`, `ViewProfile`, `BrandOffers`
- **Completeness: COMPLETE (functionally)**, but its stray `RootNavigator.js` import is a
  maintenance trap — a future reader could reasonably assume it's dead code (like
  `NoticesScreen.js` genuinely is) and remove the import, breaking `InboxScreen.js`.

### MemoryVaultIndexScreen.js
- Route: `MemoryVaultIndex` · Reached from: `ProfileScreen.js`
- Purpose: lists all matches with per-match memory counts → `MemoryVault`
- **Completeness: COMPLETE**

### MemoryVaultScreen.js
- Route: `MemoryVault` · Reached from: `MemoryVaultIndexScreen.js`, `ChatScreen.js` (menu)
- Purpose: shared, realtime, categorized memory log for a specific match
- **Completeness: COMPLETE**

### MomentumScreen.js
- Route: `Momentum` · Reached from: `ProfileScreen.js`
- Purpose: weekly streak + bar chart + month-over-month deltas
- **Completeness: COMPLETE but a dead end** (same pattern as Insights/Rewards)

### MusicModeScreen.js
- Route: `MusicMode` · Reached from: `SettingsScreen.js`
- Purpose: Spotify OAuth, pick up to 5 favorite tracks for profile display
- **Completeness: COMPLETE**

### NoticesScreen.js — **UNUSED-OR-UNREACHABLE (confirmed dead)**
- Route: imported in `RootNavigator.js` (line 42) but never wired to any `component=`; the
  `Notices` route actually renders `ActivityScreen.js` instead
- Purpose (as coded): an older, fully-featured "who noticed you" grid — Premium-locked,
  compatibility scores, "Notice Back" action
- **Completeness: UNUSED-OR-UNREACHABLE** — a complete, working, superseded screen orphaned in
  the tree, not a stub. Genuine dead code (see `IMPLEMENTATION_NOTES.md`).

### OnboardingLocationScreen.js
- Route: `OnboardingLocation` · Reached from: `OnboardingQuestionsScreen.js`
- Purpose: "Where should we start?" (near me/around my city/traveling) + location permission
  request, before `Login`
- **Completeness: PARTIAL** — the selected option is never persisted anywhere (no AsyncStorage
  write, no forwarded param); nothing downstream ever reads it. An inert choice.

### OnboardingQuestionsScreen.js
- Route: `OnboardingQuestions` · Reached from: `OnboardingScreen.js`
- Purpose: 3-step pre-signup questionnaire, staged in AsyncStorage for `CompleteProfileScreen`
- **Completeness: COMPLETE**

### OnboardingRecommendationsScreen.js
- Route: `OnboardingRecommendations` · Reached from: only `RootNavigator.js` itself,
  imperatively, gated on a `just_completed_signup` flag right after a fresh signup
- Purpose: post-signup "Based on what you told us..." recommendation list + first-mission nudge
- **Completeness: PARTIAL — a real bug, independently re-verified firsthand**: every
  recommendation card's `onPress={() => navigation.navigate('MainTabs')}` is identical
  regardless of which card's `r.id` was tapped — the specific gathering is never passed
  through, so tapping any recommendation does the same thing as the generic "Let's Go" button.
  The recommendation is cosmetic, not actionable.

### OnboardingScreen.js
- Route: `Onboarding` (unauthenticated entry point) · Purpose: first-launch welcome splash
- Links to: `OnboardingQuestions`, `Login` · **Completeness: COMPLETE**

### PaywallScreen.js
- Route: `Paywall` (modal) · Reached from: widely used across ~7 screens
- Purpose: RevenueCat subscription paywall
- **Completeness: COMPLETE** — note: surfaces raw RevenueCat error detail directly to end
  users (`Debug: {errorMessage}`) on offering-fetch failure — useful for QA, arguably shouldn't
  reach real users in production (see `IMPLEMENTATION_NOTES.md`)

### PlacesScreen.js
- Route: `Places` · Reached from: `DiscoverHubScreen.js`
- Purpose: nearby-places browser (Google Places) cross-referenced with gathering counts
- **Completeness: PARTIAL — a real bug, independently re-verified firsthand**:
  ```
  <FlatList
    ...
    ListEmpty
    Component={
      <View style={styles.emptyState}>...
  ```
  `ListEmptyComponent` is accidentally split across a line break into two meaningless props
  (`ListEmpty` — a stray boolean, ignored — and `Component={...}` — not a real `FlatList` prop,
  ignored). The "Nothing found nearby in this category" empty state can never actually render;
  an empty result set just shows a blank list.

### ProfileScreen.js
- Route: `Profile` (tab, labeled "You") · Reached from: bottom tab bar
- Purpose: editable identity page + hub of links into nearly every secondary/personal-stats screen
- Links to: `Settings`, `Communities`, `Friends`, `Gatherings` (×2), `Timeline`,
  `MemoryVaultIndex`, `Insights`, `Momentum`, `Rewards`, `Billing`, `EmergencyContacts`,
  `BusinessDashboard` (conditional), `Paywall`
- **Completeness: COMPLETE** — the most connected hub screen in the app. Note: same
  hardcoded-Edge-Function-URL pattern as `LoginScreen.js` for its AI-strengths call; also
  silently writes the device timezone to `profiles.timezone` on every load, an unannounced
  background write.

### QuickFilterCustomizeScreen.js
- Route: `QuickFilterCustomize` · Reached from: `DiscoveryScreen.js`
- Purpose: reorder/toggle the 3 Discovery quick filters
- **Completeness: COMPLETE**

### RehearsalRoomScreen.js
- Route: `RehearsalRoom` · Reached from: `SettingsScreen.js` (Reflection Tools)
- Purpose: AI role-play chat to practice difficult conversations, Premium-gated
- **Completeness: COMPLETE**

### RelationshipConstitutionScreen.js
- Route: `RelationshipConstitution` · Reached from: `ChatScreen.js` only (menu)
- Purpose: per-match realtime collaborative doc across 5 "articles"
- **Completeness: COMPLETE functionally**, but has no entry point outside the Chat menu — not
  linked from Settings/Profile at all

### RelationshipEmergencyKitScreen.js
- Route: `RelationshipEmergencyKit` · Reached from: `SettingsScreen.js` (Safety section)
- Purpose: static advice content (hard conversations, trust, resentment, reconnecting)
- **Completeness: COMPLETE** — correctly reachable from Settings, unlike most of its
  relationship-tool siblings

### RelationshipLegacyScreen.js
- Route: `RelationshipLegacy` · Reached from: `ChatScreen.js` only (menu)
- Purpose: write-side submission form feeding the public `LegacyLibraryScreen`
- **Completeness: COMPLETE functionally**, but is the "write half" of a feature whose "read
  half" (`LegacyLibraryScreen`) is reachable from Settings while this half is buried in Chat —
  a real split-discoverability gap for one conceptual feature

### RequestBusinessPartnerScreen.js
- Route: `RequestBusinessPartner` · Reached from: `CreateHubScreen.js` (×2),
  `GatheringDetailScreen.js` (preset target), `CommunityDetailScreen.js` (preset target)
- Purpose: two-step flow — pick a gathering/community you own, then request a business partner
- Links to: `CreateGathering`, `CreateCommunity` · **Completeness: COMPLETE**

### RewardsScreen.js
- Route: `Rewards` · Reached from: `ProfileScreen.js`
- Purpose: tiered loyalty status from redeemed-offer count
- **Completeness: COMPLETE but a dead end** — no CTA to go redeem an offer even at zero

### SelectGatheringLocationScreen.js
- Route: `SelectGatheringLocation` · Reached from: `CreateGatheringScreen.js` only
- Purpose: map-based location picker (search or drag pin), merges back into `CreateGathering`
- **Completeness: COMPLETE**

### SettingsScreen.js
- Route: `Settings` · Reached from: `ProfileScreen.js` only (gear icon)
- Purpose: the largest hub screen — discovery prefs, appearance, language (11), notifications,
  privacy, phone change, data export, sign out/delete, and links to nearly every secondary screen
- Links to: `Friends`, `MusicMode`, `InviteFriends`, `BlockedUsers`, `IdVerification`,
  `EmergencyContacts`, `RelationshipEmergencyKit`, `RehearsalRoom`, `ChemistryDiaryList`,
  `GoodbyeArchiveList`, `LegacyLibrary`, `Billing`, `BrandOffers`, `FeaturesOverview`, `Legal`,
  `AdminReports`/`AdminBusinessRequests`/`AdminVerification` (admin), `BusinessDashboard`/
  `BusinessPartnerApply`
- **Completeness: COMPLETE** — but conspicuously does **not** list
  `RelationshipConstitution`/`StressTest`/`SharedDecisions`/`SharedPlaylist`/`TripPlanning`/
  `TimelinePlanner`, even though it correctly lists their thematic siblings
  (RehearsalRoom/ChemistryDiary/GoodbyeArchive/LegacyLibrary/EmergencyKit) under the same
  "Reflection Tools"/"Safety" sections. This is the clearest evidence of an incomplete rollout —
  the pattern for linking these tools from Settings exists and is used for 5 of 11 tools, just
  not extended to the other 6.

### SharedDecisionsScreen.js
- Route: `SharedDecisions` · Reached from: `ChatScreen.js` only (menu)
- Purpose: per-match realtime notes across 4 "big picture" categories
- **Completeness: COMPLETE functionally**, Chat-menu-only discoverability

### SharedPlaylistScreen.js
- Route: `SharedPlaylist` · Reached from: `ChatScreen.js` only (menu)
- Purpose: collaborative realtime Spotify playlist per match
- **Completeness: COMPLETE**, with graceful fallback for legacy items without a
  `spotify_track_id`; Chat-menu-only discoverability

### StressTestScreen.js
- Route: `StressTest` · Reached from: `ChatScreen.js` only (menu)
- Purpose: per-match realtime "what if" scenario notes
- **Completeness: COMPLETE functionally**, Chat-menu-only discoverability; also reuses a
  `timeline.noThoughtsYet` translation key for its own empty state rather than its own key — a
  minor i18n mismatch

### TimelinePlannerScreen.js
- Route: `TimelinePlanner` · Reached from: `ChatScreen.js` only (menu)
- Purpose: per-match realtime relationship-pacing notes across 4 time horizons
- **Completeness: COMPLETE functionally**, Chat-menu-only discoverability; **name collision**
  with the unrelated `TimelineScreen.js` (personal activity history, reachable from Profile) —
  confusingly similar route names/labels for two unrelated features

### TimelineScreen.js
- Route: `Timeline` · Reached from: `ProfileScreen.js`
- Purpose: read-only chronological personal-milestone feed
- **Completeness: COMPLETE**

### TripPlanningScreen.js
- Route: `TripPlanning` · Reached from: `ChatScreen.js` only (menu)
- Purpose: per-match realtime trip-idea board
- **Completeness: COMPLETE functionally**, Chat-menu-only discoverability

### ViewProfileScreen.js
- Route: `ViewProfile` · Reached from: very widely used (Matches, Discovery, Activity,
  GatheringDetail, GatheringHub, Friends, Chat, Home, Gatherings)
- Purpose: view another user's full profile — photos, compatibility, badges, prompts, music,
  host stats/reputation, mutual friends
- **Completeness: COMPLETE** — one of the richest screens in the app; correctly checks mutual
  blocks before loading and skips compatibility scoring for existing friends

---

## Cross-cutting patterns found across multiple screens

- **Silent send-failure on 4 different chat-style screens** (`ChatScreen`, `CommunityChatScreen`,
  `GatheringChatScreen`, `BusinessConversationScreen`): each clears the message composer
  optimistically before the network call resolves, then swallows a failure with only a code
  comment acknowledging it ("fail quietly... would be nicer but simple for now"). A failed send
  currently loses the user's typed message with zero visible feedback, in all four places.
- **Production debug code in `ChatScreen.js`** — see that entry above. This is the single most
  concrete, user-visible bug found in this whole inventory.
- **A malformed `FlatList` prop in `PlacesScreen.js`** silently disables its empty state.
- **A dead `onPress` param in `OnboardingRecommendationsScreen.js`** makes every recommendation
  card behave identically regardless of which one was tapped.
- **Two confirmed dead/orphaned imports in `RootNavigator.js`**: `NoticesScreen` (fully dead) and
  `MatchesScreen` (alive but composed elsewhere, not routed) — both imported, neither wired to
  a `component=`.
- **A large, coherent relationship-longevity feature cluster is systematically undiscoverable**:
  6 of 11 tools are reachable only from a single 13-button `ChatScreen` alert menu, not from
  Settings or Profile — see `UX_GAPS.md` for the reliability implications (React Native's
  `Alert.alert` is documented as unreliable beyond 3 buttons on Android).
- **Several well-built "stat" screens are dead ends** (`Insights`, `Momentum`, `Rewards`) — real
  data, zero outbound CTA to act on what they show.
- **Multiple near-duplicate-named flows**: `BusinessPartnerApplyScreen` ("Partner With Us") vs.
  `RequestBusinessPartnerScreen` ("Request a Business Partner"); `TimelineScreen` vs.
  `TimelinePlannerScreen`.
- **Hardcoded backend URLs/keys appear directly in component code** in at least 3 places
  (`LoginScreen.js`, `ProfileScreen.js`, `RehearsalRoomScreen.js`) rather than going through the
  shared `services/` layer used everywhere else.
