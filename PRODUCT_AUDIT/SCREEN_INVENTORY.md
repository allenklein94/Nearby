# Screen Inventory — Nearby

*Basis: every file in `src/screens/` (74 total) was read/re-checked directly, cross-checked
against `RootNavigator.js`'s actual route wiring and a repo-wide grep of every
`navigate()`/`.replace()`/`.push()` call that targets each route. **Refreshed 2026-08-09**
against the current repo — every completeness verdict below reflects the code as it stands
today, not the 2026-08-08 original. See `AUDIT_CHANGELOG.md` for exactly what changed and why.*

## Summary

- **74 screen files** exist in `src/screens/` — up from the original audit's 73: `NoticesScreen.js`
  was deleted entirely (confirmed: file no longer exists), and two new screens shipped since —
  `RelationshipHubScreen.js` and `BusinessAIAssistantScreen.js` (73 − 1 + 2 = 74).
- **73 are reachable** through some real navigation path. **1 is not wired to a route by name**
  (`MatchesScreen.js`) — but this is confirmed **by design**, not a bug: the screen is alive and
  composed directly as a React child inside `InboxScreen.js` rather than routed to. Its
  `RootNavigator.js` import was previously dangling (unused) but that dangling import has since
  been removed — the screen itself was never dead.
- **Every screen the last audit flagged as functionally broken is now fixed**: the `ChatScreen.js`
  production debug overlay, `PlacesScreen.js`'s malformed empty state,
  `OnboardingRecommendationsScreen.js`'s identical-card-navigation bug, and the 4-screen
  silent-send-failure pattern are all confirmed resolved below.
- **The relationship-longevity discoverability gap is resolved.** A new `RelationshipHubScreen.js`
  gives all 11 tools (the 6 previously Chat-menu-only, plus their 5 already-listed siblings) a
  real, non-buried entry point from a single Settings row.
- **A small number of real gaps remain, all previously-identified and confirmed still present**:
  `ChemistryDiaryListScreen` still has no add-entry affordance; `FeaturesOverviewScreen` still
  has zero tap-through; `AdminBusinessRequestsScreen`'s Approve/Deny asymmetry is unchanged.

Legend: **COMPLETE** = fully working, no missing piece observed · **PARTIAL** = works but has a
real, observed gap (sometimes by explicit design) · **UNUSED-OR-UNREACHABLE** = no live route
reaches it.

---

### AIConciergeScreen.js
- Route: `AIConcierge` · Reached from: `DiscoverHubScreen.js` ("✨ Ask AI Concierge")
- Purpose: free-text "what should I do" query answered by the `ai-concierge` Edge Function
  over real gatherings/communities/perks
- **Completeness: COMPLETE**, unchanged. Note: hardcoded backend URL (`services/aiConcierge.js:55`)
  — see the tech-debt finding under `IMPLEMENTATION_NOTES.md`, now confirmed as one of 12 such
  call sites, not an isolated case.

### ActivityScreen.js
- Route: registered as `Notices` (label "Activity") · Reached from: `services/notifications.js`
  push-tap routing. (Its previous other caller, `ActivityBell.js`, is now confirmed dead code —
  zero importers anywhere in the repo — see `IMPLEMENTATION_NOTES.md`.)
- Purpose: unified activity feed — notices/waves, crossed-paths, friend requests, business updates
- **Completeness: COMPLETE**, unchanged.

### AdminBusinessRequestsScreen.js
- Route: `AdminBusinessRequests` · Reached from: `SettingsScreen.js` (admin-only row)
- **Completeness: COMPLETE** — the Approve-via-RPC / Deny-via-raw-`.update()` asymmetry flagged
  in the last audit is confirmed **STILL PRESENT** (`handleApprove()` calls
  `approve_business_partner_request`; `handleDeny()` is a plain client `.update()`), unchanged.

### AdminReportsScreen.js
- **Completeness: COMPLETE**, unchanged.

### AdminVerificationScreen.js
- **Completeness: COMPLETE**, unchanged — approve/reject via the atomic
  `admin_approve_id_verification` RPC.

### BillingScreen.js
- **Completeness: COMPLETE**, unchanged.

### BlockedUsersScreen.js
- **Completeness: COMPLETE**, unchanged.

### BrandOffersScreen.js
- **Completeness: COMPLETE**, unchanged. Redemption now includes a real proof-of-redemption
  confirmation code (see `PRODUCT_FLYWHEEL.md`'s Perk section and `AUDIT_CHANGELOG.md`).

### BusinessAIAssistantScreen.js — **NEW since the last audit**
- Route: `BusinessAIAssistant` · Reached from: `BusinessDashboardScreen.js`'s Insights tab
  ("✨ Ask the AI Assistant")
- Purpose: chat-thread UI over the `business-ai-assistant` Edge Function — a business owner can
  ask natural-language questions about their own real dashboard stats
- Data: `askBusinessAssistant(partnerId, question)` (`services/businessAI.js`), local-thread
  state only, nothing persisted server-side (matches the stateless single-question shape of
  `create-assistant`/`ai-concierge`)
- **Completeness: COMPLETE, structurally** — ownership gate, rate limit, and the dual-client
  pattern (needed because the four stats RPCs it calls internally require a real `auth.uid()`)
  are all confirmed live-correct (see `PRODUCT_RISKS.md`). **The actual Anthropic call path was
  not exercised end-to-end** — same disclosed, unavoidable gap as `ai-concierge`/
  `create-assistant`: this sandbox cannot mint a real signed-in session's bearer token.

### BusinessConversationScreen.js
- **Completeness: COMPLETE** — the silent-send-failure gap from the last audit is **FIXED**: a
  new shared `src/hooks/useChatComposer.js` restores the typed text and shows a real error
  message on a failed send, confirmed imported here (see `AUDIT_CHANGELOG.md` for the shared-fix
  detail, applies identically to the other 3 chat-style screens below).

### BusinessDashboardScreen.js
- Route: `BusinessDashboard` · Reached from: `CreateHubScreen.js`, `SettingsScreen.js` (2 rows),
  `ProfileScreen.js`
- Purpose: full business-owner console — stats, gatherings, community, insights, offers, inbox,
  profile editing, CRM notes, AI assistant entry point, redemption confirmation
- **Completeness: COMPLETE — upgraded from PARTIAL.** The last audit's real finding (the
  screen's own UI stated profile editing "isn't available yet") is fixed: a new "✏️ Edit
  Profile" modal + `update_business_profile` RPC (ownership-checked, confirmed live-secure)
  replaces that message entirely — confirmed via grep that the old "isn't available yet" string
  no longer appears anywhere in the file. Also gained: a persistent per-customer notes/tags CRM
  field on the existing "Most Engaged" member drill-in, a "Confirm a Redemption" card (6-digit
  proof-of-redemption code entry), and the "✨ Ask the AI Assistant" button. Now 1202 lines
  (grew from the last audit's implied count) — still flagged as a mega-screen, see
  `IMPLEMENTATION_NOTES.md`, but a real full build, not a partial one.

### BusinessPartnerApplyScreen.js
- **Completeness: COMPLETE**, unchanged — still near-identically named to
  `RequestBusinessPartnerScreen` ("Partner With Us" vs. "Request a Business Partner"), a real
  terminology-overlap risk that's unchanged since the last audit.

### BusinessProfileScreen.js
- **Completeness: COMPLETE**, unchanged.

### ChatScreen.js
- Route: `Chat` · Purpose: 1:1 match messaging + the "Do Something Together" menu into most
  relationship-tool screens
- **Completeness: COMPLETE — upgraded from PARTIAL, both prior bugs confirmed fixed**:
  1. The production debug overlay (`__DEV__ === undefined` check, always false in any real
     build) is **gone**: `grep -n "__DEV__\|DEBUG:"` across the file returns zero hits.
  2. The literal `"DEBUG: Image failed to actually render"` string is also gone.
  Additionally, the 13-button `Alert.alert()` "Do Something Together" menu — flagged in the
  last audit as a candidate Android reliability risk needing a device test — turns out to have
  **already been replaced with a real menu component** (`ActionSheetModal.js`) at the very
  commit the last audit's own snapshot was taken from, with an explicit code comment citing the
  same Android-reliability reasoning the audit independently arrived at. The silent-send-failure
  pattern is also fixed here (see `BusinessConversationScreen.js` above). **Remaining, minor**:
  3 hardcoded backend-URL call sites still exist in this file (`ChatScreen.js:515,670,800`) —
  part of the broader 12-file hardcoded-URL finding, see `IMPLEMENTATION_NOTES.md`.

### ChemistryDiaryEntryScreen.js
- **Completeness: COMPLETE**, unchanged.

### ChemistryDiaryListScreen.js
- **Completeness: PARTIAL — STILL PRESENT, unchanged.** No "+ Add Entry" affordance or
  `navigation` prop exists on this screen; the only way to create a new entry is still via
  `ChatScreen`'s menu. Directly comparable to `GoodbyeArchiveListScreen`, which has the correct
  pattern. Not touched by this session's other fixes.

### CommunitiesScreen.js
- **Completeness: COMPLETE**, unchanged.

### CommunityChatScreen.js
- **Completeness: COMPLETE** — silent-send-failure **FIXED**, same shared `useChatComposer`
  hook confirmed imported here.

### CommunityDetailScreen.js
- **Completeness: COMPLETE**, unchanged in kind, richer in content: now surfaces a "🎁 Community
  Perks" section (a business's community-scoped standing perk, previously invisible to members)
  and correctly links out to a "🏘️ Part of a community" card from `GatheringDetailScreen` when a
  gathering is already scoped to it. Both are flywheel-trace fixes, not new gaps — see
  `PRODUCT_FLYWHEEL.md`.

### CompleteProfileScreen.js
- **Completeness: COMPLETE**, unchanged — hard gate, nothing else reachable until finished.

### CreateCommunityScreen.js
- **Completeness: COMPLETE**, unchanged in structure — now also reads a
  `route.params.seedFromGatheringId` param (new: "Start a Community from This Gathering") and,
  on successful creation, invites the gathering's real friended attendees via
  `seedCommunityFromGathering()`. Shows an honest result message (all/some/none of the real
  attendees were already friends) rather than a blanket success alert.

### CreateGatheringScreen.js
- **Completeness: COMPLETE**, unchanged — the 6-step wizard (What/Who/When/Where/Details/
  Publish) is unmodified this refresh.

### CreateHubScreen.js
- **Completeness: COMPLETE**, unchanged.

### DiscoverHubScreen.js
- **Completeness: COMPLETE**, unchanged.

### DiscoveryScreen.js
- **Completeness: COMPLETE**, unchanged.

### EditGatheringScreen.js
- **Completeness: PARTIAL by explicit design**, unchanged — location/visibility/recurrence
  still can't be edited here.

### EmergencyContactsScreen.js
- **Completeness: COMPLETE**, unchanged.

### FeaturesOverviewScreen.js
- **Completeness: PARTIAL — STILL PRESENT, unchanged.** `grep -n
  "navigation.navigate\|onPress"` still returns only the expand/collapse `onPress`, zero
  navigation calls. Every one of the 25+ listed features remains non-tappable.

### FriendsScreen.js
- **Completeness: COMPLETE**, unchanged.

### GatheringChatScreen.js
- **Completeness: COMPLETE** — silent-send-failure **FIXED**, same shared hook.

### GatheringConfirmationScreen.js
- **Completeness: COMPLETE**, unchanged.

### GatheringDetailScreen.js
- **Completeness: COMPLETE**, unchanged in kind, richer in content since the last audit: now
  shows an honest "🔥 Almost full — only N spots left" nudge (real small-integer threshold, not
  an invented percentage), a "🏘️ Part of a community" card when the gathering is already scoped
  to one, and — for a host revisiting a past gathering with no existing community link — a
  "🏘️ Start a Community from This Gathering →" entry point. `join_gathering()`'s invite-only
  enforcement (previously UI-only per the last audit) is now confirmed **server-side and
  live-verified** — see `PRODUCT_RISKS.md`.

### GatheringHubScreen.js
- **Completeness: COMPLETE**, unchanged.

### GatheringsScreen.js
- **Completeness: COMPLETE**, unchanged — still the single largest, most feature-dense screen
  in the app (1421 lines, unchanged line count).

### GoodbyeArchiveEntryScreen.js / GoodbyeArchiveListScreen.js
- **Completeness: COMPLETE**, unchanged.

### HomeScreen.js
- **Completeness: COMPLETE**, unchanged.

### IdVerificationScreen.js
- **Completeness: COMPLETE**, unchanged.

### InboxScreen.js
- **Completeness: COMPLETE**, unchanged — still a "thin wrapper" per its own code comment.

### InsightsScreen.js
- **Completeness: COMPLETE — upgraded from "complete but a dead end."** Now has a real
  `navigation.navigate('Gatherings')` CTA (`InsightsScreen.js:146`). This fix has no
  corresponding entry in `CLAUDE.md`'s own changelog prose — it's real (confirmed by direct code
  read) but its provenance among the 21 commits since the last audit isn't documented anywhere
  found; flagged here as a genuine but undocumented fix, not invented.

### InviteFriendsScreen.js
- **Completeness: COMPLETE**, unchanged — still a hardcoded App Store URL in the share message.

### LegacyLibraryScreen.js
- **Completeness: COMPLETE as a read surface**, unchanged.

### LegalScreen.js
- **Completeness: COMPLETE**, unchanged — still points at a personal GitHub Pages domain.

### LoginScreen.js
- **Completeness: COMPLETE**, unchanged — the hardcoded App-Review reviewer-phone bypass and
  its hardcoded Edge Function URL/key are both still present exactly as previously found.

### MatchesScreen.js
- Route: **none**, by design — composed as a React child inside `InboxScreen.js`.
- **Completeness: COMPLETE (functionally), and the maintenance-trap risk flagged in the last
  audit is RESOLVED**: `RootNavigator.js`'s previously-dangling `MatchesScreen` import has been
  removed (confirmed via grep) — a future reader can no longer mistake this for the same kind
  of dead code `NoticesScreen.js` genuinely was.

### MemoryVaultIndexScreen.js / MemoryVaultScreen.js
- **Completeness: COMPLETE**, unchanged. Both now also reachable via the new
  `RelationshipHubScreen.js`'s "With Someone" section, in addition to their prior entry points.

### MomentumScreen.js
- **Completeness: COMPLETE — upgraded from "complete but a dead end."** Real CTA now present
  (`MomentumScreen.js:124` → `Gatherings`), same undocumented-provenance caveat as
  `InsightsScreen.js` above.

### MusicModeScreen.js
- **Completeness: COMPLETE**, unchanged.

### NoticesScreen.js — **REMOVED**
- This file no longer exists in the repo (confirmed via `ls`). At the last audit it was
  fully-built, working, dead code (superseded by `ActivityScreen.js`, orphaned in the tree).
  It has since been deleted outright, along with its dangling `RootNavigator.js` import —
  closing the one item of genuine dead code the last audit found.

### OnboardingLocationScreen.js
- **Completeness: PARTIAL, unchanged** — the selected option is still never persisted or used
  downstream.

### OnboardingQuestionsScreen.js
- **Completeness: COMPLETE**, unchanged.

### OnboardingRecommendationsScreen.js
- **Completeness: COMPLETE — FIXED.** Every recommendation card's `onPress` now correctly
  deep-links to `GatheringDetail` with the specific tapped gathering's real id
  (`navigation.navigate('GatheringDetail', { gatheringId: r.id })`, confirmed at
  `OnboardingRecommendationsScreen.js:51`) instead of the generic `MainTabs` navigate every
  card previously shared.

### OnboardingScreen.js
- **Completeness: COMPLETE**, unchanged.

### PaywallScreen.js
- **Completeness: COMPLETE**, unchanged — still surfaces raw RevenueCat error detail to end
  users on offering-fetch failure.

### PlacesScreen.js
- **Completeness: COMPLETE — FIXED.** The malformed `ListEmpty` / `Component={...}` split-prop
  bug is resolved: `PlacesScreen.js:107-108` now has one correctly-joined
  `ListEmptyComponent={...}` prop, confirmed via direct read. The empty state renders.

### ProfileScreen.js
- **Completeness: COMPLETE**, unchanged — same hardcoded-Edge-Function-URL pattern as
  `LoginScreen.js` for its AI-strengths call is still present (part of the broader 12-file
  finding, not fixed this pass), and still silently writes the device timezone to
  `profiles.timezone` on every load.

### QuickFilterCustomizeScreen.js
- **Completeness: COMPLETE**, unchanged.

### RehearsalRoomScreen.js
- **Completeness: COMPLETE**, unchanged — now also reachable via `RelationshipHubScreen.js`'s
  "On Your Own" section, in addition to its prior `SettingsScreen.js` entry.

### RelationshipConstitutionScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED.** Still reachable from `ChatScreen.js`'s
  menu, and now *also* reachable from the new `RelationshipHubScreen.js`'s "With Someone"
  section (via the existing match-scoped `RelationshipToolsScreen` picker). No longer
  Chat-menu-only.

### RelationshipEmergencyKitScreen.js
- **Completeness: COMPLETE**, unchanged — now reached via `RelationshipHubScreen.js`'s "On Your
  Own" section rather than a standalone Settings row (the row itself was folded into the hub;
  same destination screen, unchanged).

### RelationshipHubScreen.js — **NEW since the last audit**
- Route: `RelationshipHub` · Reached from: `SettingsScreen.js`'s single "❤️ Relationship" row
  (replacing the previous 6+ flat rows)
- Purpose: consolidated entry point — "With Someone" (the match-scoped `RelationshipToolsScreen`
  picker, Memory Vault index) and "On Your Own" (Rehearsal Room, Chemistry Diary, Goodbye
  Archive, Legacy Library, Emergency Kit) as two real sections instead of a flat pile of rows
- **Completeness: COMPLETE.** This is the single largest UX improvement found in this refresh —
  see `AUDIT_CHANGELOG.md` and `UX_GAPS.md`.

### RelationshipLegacyScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED**, same mechanism as
  `RelationshipConstitutionScreen.js` above: `RelationshipToolsScreen.js`'s match-tools list
  gained this item (previously missing relative to `ChatScreen.js`'s own menu), closing the
  read/write split-discoverability gap the last audit flagged.

### RelationshipToolsScreen.js
- Route: `RelationshipTools` (referenced by `RelationshipHubScreen.js`) · Purpose: match-scoped
  picker for the 8 per-match relationship tools.
- **Note**: this screen pre-existed the last audit but was omitted from that audit's own screen
  list — an omission in the original pass, not a new file. Corrected here.
- **Completeness: COMPLETE** — its tool list gained `RelationshipLegacy` and `MemoryVault`
  (previously missing relative to `ChatScreen.js`'s own menu), closing a parity gap.

### RequestBusinessPartnerScreen.js
- **Completeness: COMPLETE**, unchanged.

### RewardsScreen.js
- **Completeness: COMPLETE — upgraded from "complete but a dead end."** Real CTA now present
  (`RewardsScreen.js:96` → `BrandOffers`), same undocumented-provenance caveat as
  `InsightsScreen.js`/`MomentumScreen.js` above.

### SelectGatheringLocationScreen.js
- **Completeness: COMPLETE**, unchanged.

### SettingsScreen.js
- **Completeness: COMPLETE**, unchanged in kind, but its own biggest previously-flagged gap is
  resolved: it now has a single "❤️ Relationship" row (→ `RelationshipHub`) in place of the
  previous 6+ separate rows that conspicuously excluded 6 of 11 relationship tools. `Business
  Mode`/`managed_partner_id` duplication with `ProfileScreen.js` is unchanged.

### SharedDecisionsScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED**, same mechanism as above (now also
  reachable via `RelationshipHubScreen.js` → `RelationshipToolsScreen`).

### SharedPlaylistScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED**, same mechanism as above.

### StressTestScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED**, same mechanism as above. The minor
  i18n key-reuse note (`timeline.noThoughtsYet` borrowed for its own empty state) is unchanged —
  not independently re-checked this pass, low-severity, not re-flagged as new.

### TimelinePlannerScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED**, same mechanism as above. The
  `TimelineScreen`/`TimelinePlannerScreen` naming collision is unchanged.

### TimelineScreen.js
- **Completeness: COMPLETE**, unchanged.

### TripPlanningScreen.js
- **Completeness: COMPLETE — discoverability gap RESOLVED**, same mechanism as above.

### ViewProfileScreen.js
- **Completeness: COMPLETE**, unchanged.

---

## Cross-cutting patterns — status this refresh

- **Silent send-failure on 4 chat-style screens — FIXED.** A new shared
  `src/hooks/useChatComposer.js` restores the exact typed text and shows a visible error
  ("Couldn't send — check your connection and tap Send to try again.") on a failed send instead
  of silently clearing the composer and swallowing the error. Confirmed imported in all 4 target
  screens.
- **Production debug code in `ChatScreen.js` — FIXED.** Confirmed zero remaining `__DEV__`/
  `DEBUG:` references in the file.
- **The malformed `FlatList` prop in `PlacesScreen.js` — FIXED.**
- **The dead `onPress` param in `OnboardingRecommendationsScreen.js` — FIXED.**
- **Two confirmed dead/orphaned imports in `RootNavigator.js` — BOTH RESOLVED**: `NoticesScreen`
  (file deleted) and `MatchesScreen` (dangling import removed; screen itself was always alive).
- **The relationship-longevity discoverability gap — RESOLVED**, via the new
  `RelationshipHubScreen.js` plus the underlying `ChatScreen.js` menu having already been a real
  component rather than a fragile `Alert.alert()`.
- **Three previously-dead-end "stat" screens (`Insights`, `Momentum`, `Rewards`) now each have a
  real outbound CTA.**
- **New this refresh, not previously flagged**: the hardcoded-backend-URL pattern the last audit
  found in 3 files is confirmed to also exist in **12 additional files**
  (`aiConcierge.js`, `textModeration.js`, `photos.js`, `proximity.js`, `presenceStatus.js`,
  `dataExport.js`, `account.js`, `extraPhotos.js`, `createAssistant.js`, `ChatScreen.js` ×3,
  `CompatibilityReportModal.js`) — see `IMPLEMENTATION_NOTES.md`. A previously-unflagged dead
  component (`src/components/ActivityBell.js`, zero importers) and a stray duplicate directory
  (`src/services/src/services/textModeration.js`) were also found this refresh.
- **Still present, unchanged, no fix attempted this pass**: `ChemistryDiaryListScreen`'s missing
  add-entry button, `FeaturesOverviewScreen`'s zero tap-through, the
  `AdminBusinessRequestsScreen` Approve/Deny asymmetry, the near-duplicate-named flows
  (`BusinessPartnerApplyScreen`/`RequestBusinessPartnerScreen`, `TimelineScreen`/
  `TimelinePlannerScreen`), and `GatheringsScreen.js`/`ChatScreen.js` remaining large,
  business-logic-heavy single files.
