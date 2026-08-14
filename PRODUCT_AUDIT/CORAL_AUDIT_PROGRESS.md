# Coral ("colors.primary") usage audit — progress tracker

Started 2026-08-13, in response to the visual-identity critique's "establish stricter use of
coral" ask: **coral = action, never decoration**. This is a read-only classification audit —
no application code is being changed by this pass. 423 real occurrences of `colors.primary`
across 94 files (`src/screens/`, `src/components/`, `src/navigation/RootNavigator.js`), split
into 4 roughly-balanced batches by occurrence count, worked 2 at a time (this codebase's own
standing "cap agents at 2 concurrent" convention).

## Follow-up, 2026-08-14: targeted coral-semantic cleanup — DONE

The user reviewed the audit above and asked for a real, but deliberately narrow, cleanup rather
than a broader redesign — explicit instruction: **do not change the overall palette, do not
redesign components, do not touch navigation/IA, do not touch coral used for genuine CTAs/
selected nav/other real actions.** Established rule going forward: brand coral = actionable/
interactive only; neutral styling = informational/static; `colors.danger` = destructive/error.
Five targeted changes, all applied, all verified via a clean `@babel/core` parse of every touched
file plus a full `npx expo export --platform ios` (clean, no bundling errors):

1. **Static info/stat card borders removed** — the six confirmed non-tappable
   `primaryMuted`-bg + `primary`-border cards from the audit's "info-card border" category each
   swapped to the neutral `colors.surface`/`colors.border` pair already used by this codebase's
   own plain info cards (e.g. `statCard`): `BusinessDashboardScreen.js`'s `estimatedOwedBanner`/
   `insightsCard`/`growthCard`, `DiscoveryScreen.js`'s `calloutBanner`, `OnboardingRecommendations
   Screen.js`'s `missionCard`, `BillingScreen.js`'s `planCardActive` (kept its 1.5px extra border
   width so the "this is your current plan" distinction still reads, just without brand color).
   **Deliberately untouched, per scope**: the text labels inside these same cards that also carry
   coral (`estimatedOwedLabel`, `breakdownText`, `missionLabel`) — those are the audit's separate
   "stat/count highlighting" category, not the "card border" pattern the user's ask named, and
   touching them would have gone beyond "targeted."
2. **`GatheringDetailScreen.js`'s three lookalike cards** — confirmed via the actual JSX (not
   just the audit's earlier read) that `communityCard` is the one genuinely wrapped in a
   `TouchableOpacity` (→ `CommunityDetail`); `reasonsCard` and `youreInPanel` are both plain
   `<View>`s. Both non-tappable ones swapped to the same neutral `surface`/`border` pair;
   `communityCard` left untouched, still coral.
3. **`ActivityScreen.js`/`MatchesScreen.js` compatibility-signal inconsistency** — read both
   `compatibilityColor()` definitions directly: both return `colors.success` (not coral) for a
   genuinely great match (≥70%), `colors.primary` for a mid-range match, `colors.textTertiary`
   below that. `MatchesScreen.js`'s usage is a real `TouchableOpacity` badge (opens the
   compatibility report) — left unchanged, correctly coral. `ActivityScreen.js`'s usage is a
   passive stat nested in an already-tappable row, not its own tap target — its local
   `compatibilityColor()` (used nowhere else in that file) now returns `colors.textSecondary`
   instead of `colors.primary` for the mid-range case; the `colors.success` branch is untouched
   since it was never coral in the first place.
4. **Delete actions → `colors.danger`** — `GoodbyeArchiveListScreen.js` and
   `ChemistryDiaryListScreen.js`'s `deleteText` (both were `colors.primary`) now use
   `colors.danger`, matching this codebase's own existing convention elsewhere (e.g.
   `ChatScreen.js`'s `sendErrorText`).
5. **`PaywallScreen.js`'s debug/error text → `colors.danger`** — confirmed `errorDetail`
   (`Debug: {errorMessage}`, shown when RevenueCat offerings fail to load) is genuine error
   messaging, not decoration; swapped from `colors.primary`.

**Remaining coral used decoratively, not touched this pass (out of the explicit "targeted only"
scope, listed here per the user's own request to report what's still left)**: loading spinners
(the largest category, present in most files — no real alternative convention exists for a
spinner in this app); the sender-identity chat-bubble background across 6 chat surfaces
(deliberate, load-bearing color-coding, not a mistake — recommend keeping as-is rather than
folding into the hard rule); stat/count-highlighting text (`GatheringsScreen.js`'s `styles.time`,
`BusinessDashboardScreen.js`'s `statNumber`/`offerRedemptionCount`/`breakdownText`/
`estimatedOwedLabel`, `ProfileScreen.js`'s `completenessBarFill`, `ChemistryDiaryListScreen.js`'s
`insightBarFill`, `MomentumScreen.js`'s `barFill`, `RewardsScreen.js`'s `progressFill`,
`BrandOffersScreen.js`/`BusinessProfileScreen.js`'s `scarcityText`, `InviteFriendsScreen.js`'s
`codeText`, `OnboardingRecommendationsScreen.js`'s `missionLabel`) — a real, consistent house
pattern, but a much larger and more scattered change than "remove a border from a static card,"
deliberately left for its own explicit decision rather than swept in here; avatar/photo rings
(`MatchCelebrationModal.js`, `SightingsOverviewMap.js`, `StoriesRow.js`); "stat nested inside an
already-tappable row" cases beyond the one fixed (`HomeScreen.js`'s `continueCommunityDetail`,
`GatheringsScreen.js`'s `styles.time`, `OnboardingRecommendationsScreen.js`'s `cardMatch`,
`PlacesScreen.js`'s `placeGatherings`, `CommunityCalendar.js`'s gathering-presence dot).

**Not done, same standing gap as everywhere else in this codebase's history**: no manual
simulator/device run-through of any of the 8 touched screens — next session should confirm the
neutral cards still read clearly against their surrounding content, the Activity compat text
still looks reasonable without coral, and both Delete buttons/the Paywall error text render
correctly in the danger color on a real device.

## Follow-up, 2026-08-14: "other coral leftovers" — avatar rings + remaining nested-stat cases — DONE

Same session, continuing the same hard rule, asked to close out two of the smaller categories
explicitly left out of the first cleanup pass: avatar/photo rings, and the remaining "stat
nested inside an already-tappable row" cases beyond the one (`ActivityScreen.js`) already fixed.
Eight files, verified the same way as before (clean `@babel/core` parse of every touched file +
a full `npx expo export --platform ios`, no bundling errors):

**Avatar/photo rings (3 files)** — each checked against its real JSX first to confirm the ring
itself carries no separate tap action (distinct from `BusinessHostBadge.js`'s conditionally-
tappable badge, which was correctly left alone in the original audit):
- `MatchCelebrationModal.js`'s `photoWrap` (pure celebratory flourish, no informational content
  either — both photos get identical treatment) → `'rgba(255,255,255,0.3)'`, matching this same
  file's own existing convention for neutral text on its permanent dark overlay
  (`subtitle`/`dismissText` already use `rgba(255,255,255,...)`) rather than a semantic
  light/dark-aware token that would be invisible against a fixed black background.
- `SightingsOverviewMap.js`'s `avatarPin` (confirmed no `onPress` of its own — the sibling
  `Callout` handles the tap) → `colors.border`.
- `StoriesRow.js`'s `ringUnviewed` — **a real judgment call, not a mechanical swap**: unlike the
  other two, this ring genuinely encodes state (unviewed vs. viewed story), not just emphasis.
  Confirmed via the JSX that the ring itself isn't the tap surface (the outer `ringWrap`
  `TouchableOpacity` is, and it's tappable regardless of viewed state) — so per the hard rule it
  can't stay coral. But swapping straight to `colors.border` would have made it identical to
  `ringViewed` and erased the distinction entirely, which the audit itself never asked for and
  would be a real regression, not a decoration removed. Used `colors.textPrimary` instead — still
  a real, visually distinct "primary content" tone per the user's own stated hierarchy, not brand
  coral, and still tells unviewed from viewed at a glance.

**Remaining "stat nested inside a tappable row" cases (5)** — each swapped from `colors.primary`
to `colors.textSecondary`, keeping the stat legible and still a notch more prominent than the
plain tertiary/caption text around it, just without brand color: `HomeScreen.js`'s
`continueCommunityDetail` ("N new messages" inside the tappable community card, whose own
actionable label `continueCommunityName` was already neutral — this was the original "backwards"
inconsistency flagged in Batch 1), `GatheringsScreen.js`'s `styles.time` (the scheduled-date text
on all three nearby/attending/hosting card layouts, since they all share the one style object),
`OnboardingRecommendationsScreen.js`'s `cardMatch` ("⭐ Matches your interests"),
`PlacesScreen.js`'s `placeGatherings` ("🎉 N gathering(s) here"), and `CommunityCalendar.js`'s
gathering-presence `dot`/`dotSelected` — left `cellSelected`/`dayTextSelected` untouched, since
those genuinely are the tappable day-cell's own real selection state.

**Deliberately still not touched, per the same "targeted, not a redesign" discipline**: the
larger stat/count-highlighting text category (`GatheringsScreen.js`'s `matchBadgeText`/
`matchCard` border, `BusinessDashboardScreen.js`'s `statNumber`/`offerRedemptionCount`/
`breakdownText`/`estimatedOwedLabel`/`missionLabel`, `ProfileScreen.js`'s
`completenessBarFill`, `ChemistryDiaryListScreen.js`'s `insightBarFill`, `MomentumScreen.js`'s
`barFill`, `RewardsScreen.js`'s `progressFill`, `BrandOffersScreen.js`/`BusinessProfileScreen.js`'s
`scarcityText`, `InviteFriendsScreen.js`'s `codeText`) and the 6-surface sender-identity chat-
bubble convention — both already flagged in the prior entry as needing their own explicit
decision, still true.

**Not done, same standing gap as everywhere else**: no manual simulator/device run-through —
next session should specifically confirm `StoriesRow.js`'s unviewed/viewed ring distinction still
reads clearly at a glance now that it's `textPrimary` vs. `textViewed`'s `colors.border`, and that
`SightingsOverviewMap.js`'s neutral avatar-pin border is still visible against a real map tile
(map backgrounds vary by location/zoom in a way this sandbox can't render).

## Follow-up, 2026-08-14: stat/count-highlighting coral — DONE

Same session, closing out the larger of the two categories explicitly flagged as needing its own
decision in the prior two entries. 12 occurrences across 10 files, all confirmed via direct grep
against current line numbers (not assumed from the original audit read) before editing, since two
prior passes had already shifted some line numbers. Verified the same way as every prior entry
(clean `@babel/core` parse of all 10 files + a full `npx expo export --platform ios`, no bundling
errors). Total `colors.primary` occurrences across `src/` now 389, down from the original 423.

- **`GatheringsScreen.js`**: `matchCard`'s border modifier → `colors.border` (now a no-op against
  the base `card` style it overrides, left in place rather than removed from the JSX, since
  deleting the conditional application itself would be touching component logic, not just a
  color value). `matchBadge`/`matchBadgeText` (the "Matches your interests" pill) swapped to this
  same file's own existing neutral-badge convention — `colors.surfaceElevated` + `colors.border`
  border + `colors.textSecondary` text — matching `friendsInterestedBadge`/`friendsInterestedText`
  a few lines below it exactly, rather than inventing a new neutral badge style.
- **`BusinessDashboardScreen.js`** (4 spots): `statNumber` (the stat-grid number itself, e.g.
  follower count) → `colors.textPrimary` — stays bold/prominent, just not brand-colored.
  `offerRedemptionCount`/`breakdownText` (smaller inline stat text, `breakdownText` reused across
  6 call sites) → `colors.textSecondary`. `estimatedOwedLabel` (the "ESTIMATED AMOUNT OWED"
  caption inside the now-neutral card from the first cleanup entry) → `colors.textTertiary`,
  matching the label/value convention already established elsewhere in this same file (the actual
  number, `estimatedOwedValue`, was already `colors.textPrimary` and untouched — labels go
  tertiary, values stay prominent).
- **`OnboardingRecommendationsScreen.js`**: `missionLabel` (the "YOUR FIRST MISSION" caption
  inside the now-neutral `missionCard`) → `colors.textTertiary`, same label convention.
- **Progress-bar fills (4 files)** → `colors.textPrimary`: `ProfileScreen.js`'s
  `completenessBarFill`, `ChemistryDiaryListScreen.js`'s `insightBarFill`, `MomentumScreen.js`'s
  `barFill`, `RewardsScreen.js`'s `progressFill`. None of these encode a real state distinction
  the way `StoriesRow.js`'s ring did (they're all a single continuous fill, not two discrete
  states), so a single neutral tone was safe here without losing any signal.
- **Scarcity/status text (3 spots)** → `colors.textSecondary`: `BrandOffersScreen.js`'s
  `scarcityText` ("N of M spots left") and `redeemedBadgeText` ("Redeemed" badge),
  `BusinessProfileScreen.js`'s `scarcityText`.
- **`InviteFriendsScreen.js`**: `codeText` (the large referral code display, separate from the
  actual Share button below it) → `colors.textPrimary` — stays large/prominent, not brand-colored.

**Both categories flagged as needing an explicit decision are now resolved**: this one (fixed),
and the sender-identity chat-bubble convention (explicitly left as a deliberate keep-as-is, not
picked this round — see the prior entries for the full reasoning). Per the earlier audit's own
"Fully clean files" tracking, `colors.primary` in `src/` is now overwhelmingly reserved for real
CTAs, selected states, and links across the whole app.

**Not done, same standing gap as everywhere else**: no manual simulator/device run-through — next
session should confirm none of these 12 changes reads as washed-out or hard to distinguish from
its surrounding neutral text against real content (progress bars in particular are worth a close
look, since a fill bar with no color contrast at all against its track can become hard to read at
a glance).

## Classification rubric (given to every batch agent, restated here for consistency)

- **ACTIONABLE**: coral is applied to something the user taps to perform a real action — a
  primary CTA button's background/text/border (Join, Save, Send, Continue, Start Something), a
  tab bar's selected/active icon or label (tapping elsewhere changes the active state), an
  actively-selected filter chip, a toggle's "on" state, a link-style "See all →"/"Edit" text
  that navigates. Selected/active-state indicators count as actionable since they're
  functionally tied to an interactive control the user just used or can use.
- **DECORATIVE**: coral used on something with no tap action of its own — a section-header/
  label text color, a non-tappable badge/pill background, a border/background tint on a card
  whose real purpose is informational display (not itself the CTA), an icon tint on a purely
  informational icon, a highlighted stat/number, a progress-bar fill, an avatar ring, a loading
  spinner, a count badge number.
- **BORDERLINE**: genuinely ambiguous — flag with one-line reasoning instead of forcing a
  bucket.

## Batches

- **Batch 1** (5 files, 100 occurrences): GatheringsScreen.js(23), BusinessDashboardScreen.js(22),
  HomeScreen.js(20), DiscoveryScreen.js(18), CreateGatheringScreen.js(17)
- **Batch 2** (10 files, 107 occurrences): ChatScreen.js(16), SettingsScreen.js(12),
  DiscoverHubScreen.js(12), ViewProfileScreen.js(11), ProfileScreen.js(11),
  GatheringDetailScreen.js(10), CommunityDetailScreen.js(10), ChemistryDiaryListScreen.js(10),
  FriendsScreen.js(8), PaywallScreen.js(7)
- **Batch 3** (21 files, 104 occurrences): BrandOffersScreen.js(7), ActivityScreen.js(7),
  RequestBusinessPartnerScreen.js(6), OnboardingQuestionsScreen.js(6), BusinessProfileScreen.js(6),
  CompatibilityReportModal.js(6), RehearsalRoomScreen.js(5), OnboardingRecommendationsScreen.js(5),
  MatchesScreen.js(5), GoodbyeArchiveListScreen.js(5), CompleteProfileScreen.js(5),
  DateCheckInModal.js(5), SharedPlaylistScreen.js(4), SelectGatheringLocationScreen.js(4),
  PlacesScreen.js(4), InviteFriendsScreen.js(4), GatheringConfirmationScreen.js(4),
  EditGatheringScreen.js(4), CommunitiesScreen.js(4), RootNavigator.js(4),
  GatheringFeedbackModal.js(4)
- **Batch 4** (58 files, 112 occurrences): every remaining file with 1-4 occurrences —
  CommunityCalendar.js(4) down through the 24 files with exactly 1 (full list findable via
  `grep -rc "colors\.primary\b" src/ --include="*.js" | sort -t: -k2 -n`).

## Status

- Batch 1: DONE
- Batch 2: DONE
- Batch 3: DONE
- Batch 4: DONE

Each batch's agent should append its findings as its own `## Batch N findings` section below,
per-file, with a summary count (actionable / decorative / borderline) at the top of each file's
subsection, then a short list of the specific decorative-but-arguably-should-be-actionable (or
vice versa) cases worth flagging — not padded with every trivial confirmed-correct case.

## Audit complete — overall summary

All 4 batches done, all 94 files with real `colors.primary`/`colors.primaryMuted` occurrences
classified. This was a read-only classification pass only — no application code was changed by
this audit; the findings below are for a future product decision about whether/how to tighten
"coral = action, never decoration" as a hard rule.

**Recurring decorative categories, confirmed consistent across all 4 batches (no
file/category contradicts itself)**:
- **Loading spinners** (`ActivityIndicator`/`RefreshControl tintColor`) — by far the largest
  single decorative category, present in the strong majority of files across every batch. Low-
  stakes either way; no real alternative color convention exists in this app for a spinner.
- **Sender-identity chat bubble background** ("my own sent message" tint) — confirmed across
  **six** separate chat-style surfaces now: 1:1 chat (`ChatScreen.js`), gathering chat
  (`GatheringChatScreen.js`), community chat (`CommunityChatScreen.js`), business messaging
  (`BusinessConversationScreen.js`, `BusinessDashboardScreen.js`'s owner side), the AI
  Concierge/Business AI Assistant question bubble (`BusinessAIAssistantScreen.js`), and
  Rehearsal Room's practice chat (`RehearsalRoomScreen.js`). Some (`ChatScreen.js`'s `myBubble`,
  `BusinessDashboardScreen.js`'s `messageBubbleFromBusiness`, `GatheringChatScreen.js`'s
  `bubbleMe`, `BusinessConversationScreen.js`'s `bubble`) have a real `onLongPress` react gesture
  attached and were bucketed BORDERLINE; two (`CommunityChatScreen.js`'s `bubbleMe`,
  `BusinessAIAssistantScreen.js`'s `bubbleQuestion`) have zero attached interaction and were
  bucketed cleanly DECORATIVE. Either way, this is a deliberate, consistent, well-established
  house convention (sender color-coding), not a mistake — worth an explicit decision to keep it
  as-is regardless of any broader "coral = action" tightening, since it's load-bearing UX
  (distinguishing your messages from theirs) rather than a stray decoration.
- **Info-card border** (`colors.primaryMuted` background + `colors.primary` 1px border on a
  static, non-tappable stat/info card) — recurs in `BusinessDashboardScreen.js` (×3),
  `DiscoveryScreen.js`, `GatheringDetailScreen.js` (×2 of its 3 similar cards),
  `OnboardingRecommendationsScreen.js`, and `BillingScreen.js`'s `planCardActive`. A consistent
  house-style "this is important" visual signal applied to non-interactive containers — the
  highest-value place to reconsider if "coral = action only" becomes a hard rule, since it's
  the most systemic decorative-but-emphasis-coded pattern found.
- **Stat/count/progress highlighting** (scheduled-date text, follower/redemption counts,
  scarcity "N of M spots left" text, referral codes, progress-bar/bar-chart fills, completeness
  bars) — the second-largest decorative category, spread across nearly every batch
  (`GatheringsScreen.js`'s `styles.time`, `BusinessDashboardScreen.js`'s `statNumber`/
  `offerRedemptionCount`, `ProfileScreen.js`'s `completenessBarFill`,
  `ChemistryDiaryListScreen.js`'s `insightBarFill`, `MomentumScreen.js`'s `barFill`,
  `RewardsScreen.js`'s `progressFill`, `BrandOffersScreen.js`/`BusinessProfileScreen.js`'s
  `scarcityText`, `InviteFriendsScreen.js`'s `codeText`). Consistent enough to read as house
  style, not scattered mistakes.
- **Avatar/photo rings** (`MatchCelebrationModal.js`'s `photoWrap`, `SightingsOverviewMap.js`'s
  `avatarPin`, `StoriesRow.js`'s `ringUnviewed`) — a small, consistent, purely decorative
  status-ring category, matching the rubric's own explicit example.
- **"Stat/status nested inside an already-tappable row"** — a recurring shape where the row/card
  itself is a whole-surface `TouchableOpacity` (correctly actionable) but a stat or badge nested
  inside it is separately colored coral even though it's not itself the tap marker:
  `HomeScreen.js`'s `continueCommunityDetail`, `GatheringsScreen.js`'s `styles.time`,
  `ActivityScreen.js`'s compat-percent text, `OnboardingRecommendationsScreen.js`'s `cardMatch`,
  `PlacesScreen.js`'s `placeGatherings`, `CommunityCalendar.js`'s gathering-presence dot. This is
  the most common source of "coral drawing the eye to the wrong thing" across the whole audit.

**Real inconsistencies worth a product decision, not just a category note**:
1. **`ActivityScreen.js` vs. `MatchesScreen.js`** — both render an identical-looking "N%
   compatible" signal in the identical coral color, but only `MatchesScreen.js`'s version is
   wrapped in its own tappable element (opens the compatibility report); `ActivityScreen.js`'s is
   plain text. A user who's learned the tappable version elsewhere has no visual cue the
   Activity version does nothing.
2. **`GatheringDetailScreen.js`** — three visually near-identical `primaryMuted`-bg +
   `primary`-border "cards" on one screen (`reasonsCard`, `communityCard`, `youreInPanel`), but
   only `communityCard` is actually tappable. Same coral treatment used inconsistently as both
   "this card is a button" and "this is decoration."
3. **Delete/destructive actions using brand coral instead of `colors.danger`** —
   `GoodbyeArchiveListScreen.js`'s Delete link and `ChemistryDiaryListScreen.js`'s Delete link
   both use `colors.primary`, consistent with each other but arguably the wrong semantic color
   for a destructive action, especially now confirmed across two files, not one.
4. **`PaywallScreen.js`'s `errorDetail`** (a "Debug: {errorMessage}" string shown when RevenueCat
   offerings fail to load) uses `colors.primary` where this codebase's own convention elsewhere
   (e.g. `ChatScreen.js`'s `sendErrorText`) uses `colors.danger` for error/debug text — likely a
   real, if minor, color mistake rather than a deliberate choice.
5. **`HomeScreen.js`'s `continueCommunityDetail`** — the actionable label (community name) inside
   a fully-tappable card is neutral-colored, while the non-tappable detail stat underneath it
   ("N new messages") is coral — backwards from what "coral = action" would predict, though not
   a same-element contradiction.

**Fully clean files (100% actionable coral usage), no flags, across all 4 batches**:
`SelectGatheringLocationScreen.js`, `EditGatheringScreen.js`, `RootNavigator.js`,
`GatheringFeedbackModal.js`, `SettingsScreen.js`, `FiltersModal.js`, `GatheringIntentModal.js`,
`QuickPicksEditModal.js`, `ReportBlockModal.js`, `SwipeableDiscoveryCards.js`,
`BusinessPartnerApplyScreen.js`, `ChemistryDiaryEntryScreen.js`, `CreateCommunityScreen.js`,
`MusicModeScreen.js`, `CreateHubScreen.js`, and the 6-screen relationship-tools family
(`MemoryVaultScreen.js`/`RelationshipConstitutionScreen.js`/`SharedDecisionsScreen.js`/
`StressTestScreen.js`/`TimelinePlannerScreen.js`/`TripPlanningScreen.js`, each with one clean
send-button occurrence), plus several more single-occurrence screens
(`AIConciergeScreen.js`/`StartSomethingModal.js`/`AdminReportsScreen.js`/
`GoodbyeArchiveEntryScreen.js`/`InboxScreen.js`/`LoginScreen.js`/`OnboardingScreen.js`/
`RelationshipLegacyScreen.js`) — plain forms/pickers/single-button screens where the one or few
coral uses are naturally real controls.

**No further action taken this pass** — per the plan, this was audit-only. The next step, if the
user wants it, is a real product decision on the flagged inconsistencies above (especially the
info-card-border and destructive-delete-color patterns, which are the most systemic) before any
code changes are made.

## Batch 4 findings

Split into two sub-batches (4A: 30 files, 4B: 28 files) run in parallel, 2 concurrent agents per
this codebase's standing convention. Two occurrence counts in the original plan were
undercounts, corrected here: `BusinessHostBadge.js` is 3 (not 2), `CommunityCalendar.js` is 5
(not 4).

### Batch 4A (30 files)

**GatheringStatusBadge.js: 1 total — 0 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 38 | `pill`/`inlineText` fg color for the "Going"/"Hosting" status badge | Plain `<View>`/`<Text>`, no `onPress` anywhere in the component — a pure status label, not tappable |

**GatheringsMapView.js: 1 total — 1 actionable, 0 decorative, 0 borderline.**

Actionable (not detailed): `calloutAction` (164, "Tap to view details"/"Tap to view profile") —
sits inside a `Callout onPress={...}` where the entire callout card is the tap target; this text
is the explicit call-to-action label for that tap, the map-callout equivalent of "See all →"
link text.

**LoadErrorState.js: 1 total — 1 actionable, 0 decorative, 0 borderline.**

Actionable (not detailed): the "Try Again" button background (38) — a real retry action, reused
across ~15 screens per this shared component's own purpose.

**SightingMapModal.js: 1 total — 0 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 31 | `Marker pinColor` on the single-encounter map | No `Callout`/`onPress` attached to this marker at all — purely decorative pin color, unlike the callout-bearing markers in `GatheringsMapView.js`/`SightingsOverviewMap.js` |

**StartSomethingModal.js: 1 total — 1 actionable, 0 decorative, 0 borderline.**

Actionable (not detailed): `backText` (115, "← Back") — real `TouchableOpacity`.

**VoicePlayButton.js: 1 total — 0 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 70 | `ActivityIndicator` while resolving/loading the signed audio URL | Loading spinner, same as Batch 2's identical `ChatScreen.js` voice-bubble case |

**AIConciergeScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `askButton` (124).

**AdminBusinessRequestsScreen.js: 1 total — 0 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 68 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

**AdminReportsScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `resolveButton` (124).

**GoodbyeArchiveEntryScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `button` (134, "Save Privately").

**InboxScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `toggleButtonActive` (172) — active Messages/Activity toggle state.

**LoginScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `button` (173, "Verify").

**BusinessHostBadge.js: 3 total — 3 actionable, 0 decorative, 0 borderline.**

Badge bg/border/text (45/46/48) sit on a component whose `Wrapper` is conditionally
`TouchableOpacity` vs. plain `View` depending on an optional `navigation` prop. Both real call
sites (`GatheringsScreen.js:884`, `CommunitiesScreen.js:152`) pass `navigation`, so in practice
the badge is always the entire tap target — counted actionable. Flagged since the component
itself can render fully non-tappable for a hypothetical future caller that omits the prop.

**GifPickerModal.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 65 | `ActivityIndicator` while GIF search results load | Loading spinner |

Actionable: `cancelText` (106).

**MatchCelebrationModal.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 77 | `photoWrap`/`photoWrapLeft`/`photoWrapRight` border around both matched users' photos | Plain `<View>`, no `onPress` — decorative avatar ring, matches the rubric's explicit example |

Actionable: `messageButton` background (85, "Send a Message").

**ReportBlockModal.js: 2 total — 2 actionable, 0 decorative, 0 borderline.** Both real: `reasonChipSelected` (127), `reportButton` (135). No flags.

**SightingsOverviewMap.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 56 | `avatarPin` border wrapping each Crossed Paths marker's avatar image | Decorative avatar ring — the sibling `Callout` handles the tap, not the pin |

Actionable: `calloutAction` (63) — same "whole Callout is the tap target" reasoning as `GatheringsMapView.js`.

**SwipeableDiscoveryCards.js: 2 total — 2 actionable, 0 decorative, 0 borderline.** Both real: `waveButton` border (246), `noticeButton` background (250). No flags.

**AdminVerificationScreen.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 78 | Full-screen loading spinner | Loading spinner |

Actionable: `approveButton` background (164).

**CommunityChatScreen.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 189 | `bubbleMe` background/border (own sent message) | Confirmed zero interaction (no `onLongPress`, unlike the other-sender bubble which has one to report/block) — cleanly decorative, not even borderline |

Actionable: `sendButton` background (196).

**FiltersModal.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: `headerButton` (127), `chipActive` (140), `applyButton` (144). Clean — no flags.

**GatheringIntentModal.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: `optionSelected`/`optionLabelSelected` (101/104), `submitButton` (105). Clean — no flags.

**GatheringQnA.js: 3 total — 2 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 149 | `answerLabel` ("Host: " prefix) | Plain `<Text>` label prefix, not tappable |

Actionable: `answerSubmitText` (153), `askSubmitText` (156).

**InviteFriendsModal.js: 3 total — 2 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 97 | `ActivityIndicator` while the friends list loads | Loading spinner |

Actionable: `inviteButton` background (163), `shareLink` (167, "📤 Invite someone not on Nearby yet").

**QuickPicksEditModal.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: selected category-chip (56), `saveButton` (93), `resetButtonText` (96). Clean — no flags.

**StoriesRow.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 104 | `ActivityIndicator` inside the "post a story" ring while uploading | Loading spinner |
| 148 | `ringUnviewed` border on a story avatar ring | Decorative avatar-ring status nested inside an already-tappable row — same pattern established repeatedly since Batch 1 |

Actionable: `addIcon` (151) — the entire ring is one `TouchableOpacity`, and the "+" glyph is the entire visual content marking that tap surface, matching Batch 3's `SharedPlaylistScreen.js` "+" precedent.

**BillingScreen.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 71 | Full-screen loading spinner | Loading spinner |
| 170 | `planCardActive` border on the "Premium" plan card | Info-card border on a non-tappable container — the real CTA (Manage Subscription) is a separate nested button |

Actionable: `manageButton` background (177).

**BlockedUsersScreen.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 85 | Full-screen loading spinner | Loading spinner |
| 103 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

Actionable: `unblockButton` background (156).

**BusinessAIAssistantScreen.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 59 | `ListFooterComponent` `ActivityIndicator` while the assistant answers | Loading spinner |
| 92 | `bubbleQuestion` background (owner's own sent question) | Zero attached interaction — cleanly decorative, same pattern as `CommunityChatScreen.js`'s `bubbleMe` above |

Actionable: `askButton` background (102).

**CommunityCalendar.js: 5 total — 3 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 104 | `dot` background (marks any day with a gathering) | Informational "has a gathering" presence marker, rendered regardless of selection — not itself a selection signal |
| 105 | `dotSelected` background | Same dot/color on the selected day — still just the presence marker |

Actionable: `navArrow` (93, prev/next-month), `cellSelected` background (99) and `dayTextSelected`
color (103) — both on the day-cell's own `TouchableOpacity`, a real tap-to-select state. Clean
within-component split: the cell's own selection state is actionable, the gathering-presence dot
sitting inside it is decorative.

### Batch 4B (28 files)

**MemoryVaultIndexScreen.js: 1 total — 0 actionable, 1 decorative, 0 borderline.** Loading spinner (48).

**MemoryVaultScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `addButton` (147) — shared relationship-tools composer "+" button.

**OnboardingScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `primaryButton` (54, landing screen Continue/Get Started).

**QuickFilterCustomizeScreen.js: 1 total — 0 actionable, 1 decorative, 0 borderline.** Loading spinner (74).

**RelationshipConstitutionScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `addButton` (149) — same composer pattern.

**RelationshipLegacyScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `button` (146, main submit).

**RelationshipToolsScreen.js: 1 total — 0 actionable, 1 decorative, 0 borderline.** Loading spinner (95).

**SharedDecisionsScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `addButton` (144) — same composer pattern.

**StressTestScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `addButton` (148) — same composer pattern.

**TimelinePlannerScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `addButton` (147) — same composer pattern.

**TimelineScreen.js: 1 total — 0 actionable, 1 decorative, 0 borderline.** Loading spinner (44).

**TripPlanningScreen.js: 1 total — 1 actionable, 0 decorative, 0 borderline.** Actionable: `addButton` (141) — same composer pattern.

**CreateHubScreen.js: 2 total — 2 actionable, 0 decorative, 0 borderline.** Both real: `backLink` (182), `assistantButton` (203, Create Assistant submit). No flags.

**EmergencyContactsScreen.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 84 | Full-screen loading spinner | Loading spinner |

Actionable: `addButton` (197, "Add Contact").

**GatheringChatScreen.js: 2 total — 1 actionable, 0 decorative, 1 borderline.**

| Line | Element | Reason |
|---|---|---|
| 280 `bubbleMe` | Own sent bubble background | **Borderline** — same sender-identity convention as `ChatScreen.js`'s `myBubble`/`BusinessDashboardScreen.js`'s `messageBubbleFromBusiness` |

Actionable: `sendButton` background (287).

**GatheringHubScreen.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 178 | Full-screen loading spinner ("Loading the gathering hub...") | Loading spinner |

Actionable: "View gathering →" link text (205).

**InsightsScreen.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 46 | Full-screen loading spinner | Loading spinner |

Actionable: `ctaButton` (217, "🔎 Find a gathering near you").

**LegacyLibraryScreen.js: 2 total — 0 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 53 | Full-screen loading spinner | Loading spinner |
| 71 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

**MyBusinessApplicationScreen.js: 2 total — 1 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 57 | Full-screen loading spinner | Loading spinner |

Actionable: `button` (188, Submit a New Application / Go to Business Dashboard).

**BusinessConversationScreen.js: 3 total — 2 actionable, 0 decorative, 1 borderline.**

| Line | Element | Reason |
|---|---|---|
| 164-165 `bubble` | Own sent message bubble (customer side) | **Borderline** — same sender-identity convention as elsewhere |

Actionable: `sendButton` background (174).

**BusinessPartnerApplyScreen.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: `button` (217), `chipActive` (221), `checkboxChecked` (226). Clean — no flags.

**ChemistryDiaryEntryScreen.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: `signalRowActive` (121), `checkboxChecked` (128), `button` (132). Clean — no flags.

**CreateCommunityScreen.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: `visToggleActive`/`visToggleTextActive` (212/214), `button` (215). Clean — no flags.

**IdVerificationScreen.js: 3 total — 2 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 79 | Full-screen loading spinner | Loading spinner |

Actionable: `captureButtonText` (163), `submitButton` (165).

**MomentumScreen.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 50 | Full-screen loading spinner | Loading spinner |
| 173 `barFill` | Weekly activity bar-chart fill | Progress/bar-chart fill, not a tap target |

Actionable: `ctaButton` (188).

**MusicModeScreen.js: 3 total — 3 actionable, 0 decorative, 0 borderline.** All real: `trackRowSelected` (172), `checkmark` (177), `saveButton` (178). Clean — no flags.

**PlansScreen.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 140 | Full-screen loading spinner | Loading spinner |
| 150 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

Actionable: `tabActive` (195, Upcoming/Hosting/Past tab selector).

**RewardsScreen.js: 3 total — 1 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 41 | Full-screen loading spinner | Loading spinner |
| 138 `progressFill` | Tier progress bar fill | Progress-bar fill, not a tap target |

Actionable: `ctaButton` (153, "🎁 Browse perks near you").

### Batch 4 cross-file notes

- **Loading spinners** remain the largest decorative category — present in ~21 of the 58 files.
- **Sender-identity chat bubbles recur four more times** (`CommunityChatScreen.js`,
  `GatheringChatScreen.js`, `BusinessConversationScreen.js`, `BusinessAIAssistantScreen.js`),
  bringing the total to six chat-style surfaces using this convention — see the overall summary
  above. Two of these four (`CommunityChatScreen.js`'s `bubbleMe`,
  `BusinessAIAssistantScreen.js`'s `bubbleQuestion`) have zero attached interaction and were
  bucketed cleanly decorative rather than borderline, unlike the ones with a real long-press
  react gesture — useful confirming data that the pattern is decorative-by-default absent an
  attached interaction.
- **Map-`Callout` "Tap to view..." action text** is a new category this batch
  (`GatheringsMapView.js`, `SightingsOverviewMap.js`) — classified actionable since the entire
  `Callout` is the tap target and the text is its explicit call-to-action label, functionally
  equivalent to a "See all →" link.
- **Avatar rings** recur again (`MatchCelebrationModal.js`, `SightingsOverviewMap.js`,
  `StoriesRow.js`) — consistent, firmly-established decorative category.
- **`CommunityCalendar.js`** is a clean, self-contained example of the rubric's own core
  distinction: the day-cell's own tap-to-select state is actionable, the gathering-presence dot
  inside it is decorative.
- **`BusinessHostBadge.js`** is conditionally tappable (depends on an optional `navigation` prop)
  — classified actionable because both real call sites pass it, but flagged as a judgment call
  tied to current usage, not an inherent property of the component.
- Roughly half of Batch 4's 58 files are fully clean (100% actionable) — expected, since most
  low-occurrence-count files are simple single-purpose forms/pickers/buttons.

## Batch 3 findings

**BrandOffersScreen.js: 7 total — 2 actionable, 5 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 153 | Full-screen loading spinner | Loading spinner |
| 172 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |
| 294 `cardHighlighted` | Border applied to an offer card when linked-to from elsewhere (scroll-to target) | Plain `<View>` card — not itself the tap target (a nested `TouchableOpacity` on the partner name/logo and a separate redeem button are); this is a "you scrolled here" highlight, not a tap indicator |
| 301 `scarcityText` | "N of M spots left" / unlock-progress line | Plain `<Text>`, not tappable — informational stat |
| 306 `redeemedBadgeText` | "Redeemed" badge on an already-claimed offer | Plain `<View>` badge (not `TouchableOpacity`) — non-tappable status label |

Actionable (not detailed): the "+ Follow" / "✓ Following" link text (302, wrapped in a real
follow/unfollow `TouchableOpacity`) and the redeem button background (303).

**ActivityScreen.js: 7 total — 5 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 271 `compatibilityColor()` (used at line 557) | "N% compatible" text inside a notice/wave row | The row itself is a `TouchableOpacity` (navigates to the profile), but this specific text is a nested stat readout, not a separately-tappable element or the row's own tap marker — same "stat highlight inside an already-tappable card" pattern as `HomeScreen.js`'s `continueCommunityDetail` (Batch 1) |
| 495 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

Actionable (not detailed): the Premium-upsell banner's background (608, the whole banner is one
`TouchableOpacity` → Paywall), the Wave row's border (624, the whole row is one `TouchableOpacity`
→ profile), the "View gathering →" link text inside each Today/reminder row (630, same
whole-row-is-the-tap-target pattern), the "notice back" inline button background (631), and the
Approve/Accept/Decline action buttons (644).

**Flag — real cross-file inconsistency**: `ActivityScreen.js`'s "N% compatible" text (271/557) and
`MatchesScreen.js`'s "N% · Why?" compat badge (see below) render the *same* signal in the *same*
coral color, but only one of them is actually tappable. In `MatchesScreen.js` the badge is its own
nested `TouchableOpacity` opening the compatibility report (correctly actionable); in
`ActivityScreen.js` the identical-looking "N% compatible" text is just embedded in the row's
subtitle with no tap of its own. A user who's seen the tappable version on Matches has no visual
cue that the same-colored text on Activity does nothing if tapped.

**RequestBusinessPartnerScreen.js: 6 total — 4 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 130 | Full-screen loading spinner | Loading spinner |
| 236 | Inline "searching" spinner | Loading spinner |

Actionable (not detailed): the selected category-filter chip background/border (309), the
"Change" link on the selected-business card (333, real `TouchableOpacity`), the submit button
background (335), and the empty-state "🎉 Start a Gathering"/"👥 Create a Community" link text
(342, both real navigating `TouchableOpacity`s).

**OnboardingQuestionsScreen.js: 6 total — 5 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 216 `dotActive` | Step-progress dot at the top of the flow | Plain `<View>`, not tappable — can't jump to a step by tapping it, same "progress-bar fill" pattern as `CreateGatheringScreen.js`'s `progressDotActive` (Batch 1) |

Actionable (not detailed): the selected motivation-chip background/text (205/208), the selected
comfort-level option background/text (210/212), and the Continue button (217).

**BusinessProfileScreen.js: 6 total — 4 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 138 | Full-screen loading spinner | Loading spinner |
| 314 `scarcityText` | "N of M spots left" line under a standing offer | Plain `<Text>`, not tappable — same informational-stat pattern as `BrandOffersScreen.js`'s `scarcityText` above |

Actionable (not detailed): the Follow button background (301), the Message button
border/text (305/306), and the redeem button background (315).

**CompatibilityReportModal.js: 6 total — 4 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 114 | Loading spinner while the intro-sentence generates | Loading spinner |
| 247 `matchChipText` | Shared-interest chip text (e.g. "Hiking") | Plain `<View>` chip, not tappable |

Actionable (not detailed): the active score/compass/friction toggle-tab background/border (231),
the "✨ Why you two might connect" button border/text (235/238), and the Close button (268).

**RehearsalRoomScreen.js: 5 total — 2 actionable, 2 decorative, 1 borderline.**

| Line | Element | Reason |
|---|---|---|
| 154 | Send-button loading spinner | Loading spinner |
| 178 `practiceBannerText` | "You're practicing — this isn't a real person" reminder text | Plain `<Text>` inside a non-tappable `<View>` banner — purely informational |
| 184 `myBubble` | **Borderline** — background of the user's own sent chat bubble | Same borderline call as Batch 1/2's `messageBubbleFromBusiness`/`myBubble` — a deliberate sender-identity color-coding convention, not a decoration in the badge/stat sense, but not marking anything tappable either (the message is already sent) |

Actionable (not detailed): the "End" practice-session link text (179, real `TouchableOpacity`)
and the Send button text (191).

**OnboardingRecommendationsScreen.js: 5 total — 1 actionable, 4 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 52 | Loading spinner while recommendations load | Loading spinner |
| 116 `cardMatch` | "⭐ Matches your interests" line inside a recommendation card | The card itself is a whole-row `TouchableOpacity`, but this line is a nested stat/badge, not the row's own tap marker — same pattern as `ActivityScreen.js`'s compat text above |
| 123 `missionCard` | Border of the "Your first mission" card | Plain `<View>`, no `onPress` — purely informational, same "info-card border" pattern flagged repeatedly in Batch 1/2 |
| 126 `missionLabel` | "Your first mission" label text inside that same non-tappable card | Plain `<Text>`, not tappable |

Actionable (not detailed): the "Let's Go" continue button (128).

**MatchesScreen.js: 5 total — 4 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 259 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

Actionable (not detailed): `compatibilityColor()` (220, used at 302/307) — unlike
`ActivityScreen.js`'s identical-looking use of the same helper, here the "N% · Why?" badge is its
own nested `TouchableOpacity` that opens the compatibility report, so it's correctly actionable
(see the cross-file flag under ActivityScreen above) — plus the offers-banner border (351, whole
banner is one `TouchableOpacity` → BrandOffers) and its text/arrow (353/354).

**GoodbyeArchiveListScreen.js: 5 total — 3 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 93 | Full-screen loading spinner | Loading spinner |
| 111 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

Actionable (not detailed): the "+ Add Entry" button background (202), the per-entry "Delete" link
text (215, real `TouchableOpacity`), and the name-prompt sheet's submit button (223).

**CompleteProfileScreen.js: 5 total — 4 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 272 `badgeText` | "18+ ONLY" badge near the top of the form | Plain `<View>` badge, not tappable — static status label |

Actionable (not detailed): the selected interest-chip background (290), the checked
terms-checkbox background (298, a real toggle state), the Terms of Service/Privacy Policy link
text (301, real `Linking.openURL` taps), and the Continue button (302).

**DateCheckInModal.js: 5 total — 4 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 172 | "Sharing location" loading spinner | Loading spinner |

Actionable (not detailed): the "No emergency contact saved yet — add one →" link text (194, real
`TouchableOpacity` → EmergencyContacts), the "Set Up Check-In & Share Plans" button (197), and the
"📍 Share My Location Now" button border/text (200/203).

**SharedPlaylistScreen.js: 4 total — 2 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 121 | Search-loading spinner | Loading spinner |
| 148 | Per-row "adding" spinner (replaces the `+` icon while a track is being added) | Loading spinner |

Actionable (not detailed): the `+` add-icon (212) — it's the visual affordance for the action
inside a row that's entirely one `TouchableOpacity` (tapping anywhere on the row adds the track),
so it's marking the tap surface, not decorating a passive container — and the "🎧 Open" button
background (225).

**SelectGatheringLocationScreen.js: 4 total — 4 actionable, 0 decorative, 0 borderline.**

Every occurrence is a real button: the address-search "Go" button background (135), the "📍 Use My
Current Location" button border/text (139/142), and the "Confirm Location" button background
(143). Cleanest file in this batch alongside `EditGatheringScreen.js`/`RootNavigator.js`/
`GatheringFeedbackModal.js` — no flags.

**PlacesScreen.js: 4 total — 2 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 101 | Loading spinner | Loading spinner |
| 175 `placeGatherings` | "🎉 N gathering(s) here" line inside a place card | The card is a whole-row `TouchableOpacity` (opens Google Maps), but this line is a nested stat, not the tap marker itself — same pattern as `ActivityScreen`/`OnboardingRecommendationsScreen` above |

Actionable (not detailed): the selected category-filter chip background/text (162/165).

**InviteFriendsScreen.js: 4 total — 2 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 83 | Full-screen loading spinner | Loading spinner |
| 157 `codeText` | The referral code itself, displayed large | Plain `<Text>`, not tappable — the actual action (Share) is a separate button below it |

Actionable (not detailed): the Share button background (158) and the redeem-code button
background (170).

**GatheringConfirmationScreen.js: 4 total — 2 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 100 | Full-screen loading spinner | Loading spinner |
| 147 | "Loading friends" spinner in the invite step | Loading spinner |

Actionable (not detailed): the "🔗 Share Gathering" button background (201, the primary action —
"🤝 Invite Connections" is a secondary neutral-styled button right below it, reusing the same
style object but not carrying coral itself) and the per-friend "Invite" button background (216).

**EditGatheringScreen.js: 4 total — 4 actionable, 0 decorative, 0 borderline.**

Every occurrence is a real control: the selected 1-5 vibe-scale option background/border and text
(281/283, tap-to-select), the "+ Add a step" link text (291, real `TouchableOpacity`), and the
Save button background (292).

**CommunitiesScreen.js: 4 total — 2 actionable, 2 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 66 | Full-screen loading spinner | Loading spinner |
| 86 | `RefreshControl tintColor` | Pull-to-refresh spinner tint |

Actionable (not detailed): the "+ Create" button background (175) and the per-community "Join"
button background (190).

**RootNavigator.js: 4 total — 4 actionable, 0 decorative, 0 borderline.**

All four are the bottom tab bar's own active/selected-state color: the Profile tab's avatar-ring
border and icon color when focused (147/154), the shared `tabBarActiveTintColor` (228), and the
active-icon color function used by the other four tabs (243). All genuine selected-state
indicators tied to the tab the user just tapped — matches the established "active tab state
counts as actionable" convention exactly. No flags.

**GatheringFeedbackModal.js: 4 total — 4 actionable, 0 decorative, 0 borderline.**

Every occurrence is a real, tappable selection/submit control: the selected satisfaction-rating
option background/border (193), the selected "what made it great" chip background/border and text
(202/204), and the Submit button background (205).

### Batch 3 cross-file notes

- **Real inconsistency worth fixing**: `ActivityScreen.js`'s "N% compatible" text (line 271/557)
  and `MatchesScreen.js`'s "N% · Why?" compat badge render the identical signal in the identical
  color, but only the Matches version is wrapped in its own tappable element. See the flag under
  ActivityScreen above.
- **"Stat highlight nested inside an already-tappable row/card" is now confirmed as a recurring
  pattern across three more files this batch** (`ActivityScreen.js`'s compat text, `Onboarding
  RecommendationsScreen.js`'s `cardMatch`, `PlacesScreen.js`'s `placeGatherings`) — same shape as
  Batch 1's `HomeScreen.js` `continueCommunityDetail` and `GatheringsScreen.js` `styles.time`.
  This is now a well-established, cross-batch decorative category, not a one-off.
- **"Info-card border on a non-tappable container" recurs again**: `OnboardingRecommendations
  Screen.js`'s `missionCard` border matches the exact `primaryMuted` background +
  `colors.primary` 1px border recipe already flagged repeatedly in Batch 1/2
  (`BusinessDashboardScreen.js`'s estimated-owed/insights/growth cards,
  `DiscoveryScreen.js`'s tip callout). Same house-style pattern, still decorative by the strict
  rubric.
- **"Scarcity/status text" (spots-left counts, referral codes, redeemed badges) is a consistent
  decorative category across this batch**: `BrandOffersScreen.js`'s `scarcityText`/
  `redeemedBadgeText`, `BusinessProfileScreen.js`'s `scarcityText`, `InviteFriendsScreen.js`'s
  `codeText` — all plain, non-tappable text/badges carrying coral purely to draw the eye to a
  number or status, consistent with each other and with Batch 1/2's `statNumber`/
  `offerRedemptionCount` findings.
- **Possible color-convention question, not a within-file bug**: destructive "Delete" actions use
  `colors.primary` rather than `colors.danger` in both `GoodbyeArchiveListScreen.js` (line 215)
  and Batch 2's `ChemistryDiaryListScreen.js` (line 327) — consistent with each other, so not a
  same-screen contradiction, but worth a product decision on whether a delete action should use
  the danger color instead of brand coral, especially now that it's established across two files,
  not one.
- **Loading spinners remain the single largest decorative category** — present in 15 of this
  batch's 21 files (`ActivityIndicator`/`RefreshControl tintColor`), fully consistent with itself
  and with Batches 1-2.
- **Four files in this batch are fully clean (100% actionable)**: `SelectGatheringLocationScreen.js`,
  `EditGatheringScreen.js`, `RootNavigator.js`, `GatheringFeedbackModal.js` — every occurrence is a
  real button, selected-state, or navigating link.

## Batch 2 findings

**ChatScreen.js: 16 total — 9 actionable, 6 decorative, 1 borderline.**

| Line | Element | Reason |
|---|---|---|
| 91 | Spinner in voice-bubble play button | Loading spinner — decorative per rubric even though the button itself is actionable |
| 1099 | Spinner in "Get an AI icebreaker" empty-state button | Loading spinner |
| 1146 | Spinner while a GIF/photo bubble's media loads | Loading spinner, not a tap target |
| 1296 | Spinner in the inline icebreaker (✨) button | Loading spinner |
| 1351 | Spinner in the mic/record button | Loading spinner |
| 1407 `firstMessageHint` | "{name} will send the first message." caption | Plain informational `<Text>`, not tappable |
| 1415 `myBubble` | Background of the caller's own text message bubble | **Borderline** — the bubble row has `onLongPress` (react), but coral here is sender-identity color-coding ("this is my message"), not a signal that the bubble itself is the action |

Actionable (not detailed): the two "⋯" chat-options menu triggers (295, 383), the icebreaker
empty-state button's border/text (1408/1409), the "get a suggestion" stalled-conversation link
(1435), the small inline icebreaker button's border (1456), the send button text (1482), and the
stop-recording/send button background (1494).

**SettingsScreen.js: 12 total — 12 actionable, 0 decorative, 0 borderline.**

Every occurrence is either a `Switch`'s `trackColor.true` (8 switches: gender/ethnicity-hidden
toggles, dark mode, notify-matches/messages/waves, read receipts, women-message-first — all real
on/off state) or a real tappable element (the "notifications are off, tap to enable" banner
border, the selected-ethnicity chip background, the "Save Preferences" button, the "Delete
Account" link text). Cleanest file in this batch — no flags.

**DiscoverHubScreen.js: 12 total — 7 actionable, 5 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 418 | Full-screen loading spinner | Loading spinner |
| 478 | "Gatherings" search-loading spinner | Loading spinner |
| 524 | "Communities" search-loading spinner | Loading spinner |
| 569 | "Places" loading spinner | Loading spinner |
| 610 | "Perks" search-loading spinner | Loading spinner |

Actionable (not detailed): the gathering-story-viewer "Close" button (712), the "Ask AI
Concierge" row's border/text/chevron (768/771/772), the active filter chip's background/border
and text (778/781), and the "See all in Gatherings →" link (804).

**ViewProfileScreen.js: 11 total — 6 actionable, 5 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 191 | Full-screen loading spinner | Loading spinner |
| 217 | "✨ Premium" badge color in the static badges row | Non-tappable status badge |
| 510 `intentionText` | "Looking for: {intention}" inside `intentionCard` | Plain `<View>`, no `onPress` — informational display only |
| 546 `interestChipText` | Interest tag chips (e.g. "Hiking") | Plain `<View>` chips, not tappable |
| 565 `dotActive` | Active photo-carousel pagination dot | Passive position indicator, not itself tappable (swipe navigates) |

Actionable (not detailed): the "⋯" report/block menu trigger (160), the compatibility-score
badge's border+text color via `compatibilityColor()` (242 — the badge itself is a
`TouchableOpacity` opening the "why?" compatibility modal), the voice-intro play button
background (537), and the Add Friend button's border/text (548/553) and Chemistry Diary link
text (555).

**ProfileScreen.js: 11 total — 10 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 1121 `completenessBarFill` | Profile-completeness progress bar fill | Progress-bar fill, not a tap target |

Actionable (not detailed): the Business Mode button (1152), the photo-edit pencil badge
overlaid on the (fully tappable) photo picker (1174), the selected-interest chip (1222), the
main Save button (1225), the "Generate AI Strengths" button border/text (1229/1231), the "+ Add
a Prompt" button border/text (1241/1244), the voice-intro play button background (1250), and the
modal Cancel link (1256).

**GatheringDetailScreen.js: 10 total — 6 actionable, 4 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 223 | Full-screen loading spinner | Loading spinner |
| 684 `almostFullNudge` | "🔥 Almost full — only N spots left..." | Plain `<Text>`, not tappable — informational urgency nudge |
| 695 `reasonsCard` | Border of the "Why this fits you" card | Plain `<View>`, informational display, not itself a CTA |
| 758 `youreInPanel` | Border of the "You're in! 🎉" post-join panel | Plain `<View>` container — the real CTA (Say Hello) is a separate button nested inside it |

Actionable (not detailed): the "at {business}" perk link (730, navigates to `BusinessProfile`),
the entire "🏘️ Part of a community" card border/kicker/subtext (733/736/738, the whole card is a
`TouchableOpacity` to `CommunityDetail`), the host banner's four action links — Manage
attendees / Invite friends / Request a Business Partner / Start a Community (748), and the "Say
Hello" button background (763).

**Flag — real inconsistency worth fixing:** this single screen has three visually similar
bordered/tinted "card" treatments using the exact same `colors.primaryMuted` background +
`colors.primary` border recipe (`reasonsCard` 695, `communityCard` 733, `youreInPanel` 758), but
only one of the three (`communityCard`) is actually tappable. A reader can't tell from the
coral treatment alone which of these three near-identical cards is a real link and which two are
just informational — the coral border is being used inconsistently as both "this card is a
button" and "this is decoration on some other button that's inside/near me."

**CommunityDetailScreen.js: 10 total — 7 actionable, 3 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 168 | Full-screen loading spinner | Loading spinner |
| 492 `memberRoleCreator` | "Creator" role label in the members list | Plain `<Text>`, not tappable — status badge |
| 493 `memberRoleLeader` | "Leader" role label in the members list | Plain `<Text>`, not tappable — status badge |

Actionable (not detailed): the Join button background (456), the Community Chat button
border/text (460/461), the perk card's "at {business}" link (474, navigates to
`BusinessProfile`), the perk redeem button background (478), the "Make Leader/Remove Leader"
action link (494), and the active List/Calendar view-toggle background (498).

**ChemistryDiaryListScreen.js: 10 total — 6 actionable, 4 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 129 | Full-screen loading spinner | Loading spinner |
| 151 | Pull-to-refresh spinner tint | Loading spinner |
| 315 `insightBarFill` | Signal-percentage bar fill inside the expanded "Your Patterns" card | Progress-bar fill, not a tap target (even though the parent card that contains it is itself tappable to expand/collapse) |
| 330 `signalChipText` | Per-entry signal chips (e.g. "😊 Felt at ease") | Plain `<View>` chips, not tappable |

Actionable (not detailed): the "+ Add Entry" button (290), the modal's submit button (298), the
entire "✨ Your Patterns" insights card — border, title, and expand/collapse chevron
(303/306/307, the whole card is a `TouchableOpacity`), and each entry's "Delete" link (327).

**FriendsScreen.js: 8 total — 7 actionable, 1 decorative, 0 borderline.**

| Line | Element | Reason |
|---|---|---|
| 171 | Full-screen loading spinner | Loading spinner |

Actionable (not detailed): "Find Contacts" button (485), the active circle-filter chip
background (506), the "+ New Circle" chip border/text (510/513), the circle-create modal's
submit button (521), the circle-membership checkbox's checkmark color inside the manage-circles
modal (525 — a real toggle-state indicator), and the "Accept" friend-request button (531).

**PaywallScreen.js: 7 total — 3 actionable, 3 decorative, 1 borderline.**

| Line | Element | Reason |
|---|---|---|
| 91 | Loading spinner while offerings load | Loading spinner |
| 169 `badgeText` | "✨ PREMIUM" badge above the screen title | Plain `<View>` badge, not tappable |
| 186 `alreadyPremiumCard` | Border of the "You're already Premium 🎉" card | Plain `<View>` container — the real CTA (Manage Subscription) is a separate button nested inside it |
| 227 `errorDetail` | **Borderline** — "Debug: {errorMessage}" text shown when RevenueCat offerings fail to load | Not tappable, so decorative by the rubric — but also a likely real color mistake: this is an error/debug message and everywhere else in this codebase error text uses `colors.danger`, not the brand coral. Worth a second look as a bug, not just a decoration/action question. |

Actionable (not detailed): the "Manage Subscription" button background (191), and the featured
(annual) plan button's background/border, which is the real purchase CTA (204/205).

### Batch 2 cross-file notes

- **Loading spinners are the single largest decorative category in this batch** (present in 9
  of the 10 files) — every one of them tints `ActivityIndicator`/`RefreshControl` with the brand
  coral. This is consistent with itself across the batch (no file does it differently), but as a
  category it's the best candidate for a "should this even be coral" design conversation, since
  a spinner is never itself an action.
- **Real inconsistency, GatheringDetailScreen.js**: see the flag above — three near-identical
  coral-bordered cards on one screen, only one of which is actually tappable.
- **Likely real bug, PaywallScreen.js line 227**: `errorDetail` uses `colors.primary` for a
  debug/error string, where `colors.danger` would match this codebase's own convention
  elsewhere (e.g. `ChatScreen.js`'s `sendErrorText` uses `colors.danger`).
- **Static status/role badges consistently decorative**: "Premium" badges (`ViewProfileScreen`
  217, `PaywallScreen` 169), community member role labels (`CommunityDetailScreen` 492/493), and
  static interest/signal chips (`ViewProfileScreen` 546, `ChemistryDiaryListScreen` 330) all use
  coral purely as an identity/status color with zero tap action — consistent with each other,
  but a large share of this batch's "decorative" count.
- **SettingsScreen.js stands out as the one fully clean file** in this batch — all 12 uses are
  genuine toggle/selection/button states, no informational-only coral anywhere.

## Batch 1 findings

**Classification note carried across this batch**: when a border/background tint is applied to
an element that is *itself* the entire tap target (e.g. a whole banner or card wrapped in one
`TouchableOpacity` that navigates/toggles), that border/tint is counted ACTIONABLE — it's marking
the interactive surface, not decorating a passive container. When the same tint sits on a plain
`View` that only *contains* separately-tappable sub-elements (the tint itself isn't the tap
target and doesn't change if you tap something inside), it's counted DECORATIVE. This distinction
recurs in every file below and is called out inline where it's a close call.

### GatheringsScreen.js: 23 total — 16 actionable, 7 decorative, 0 borderline

Decorative cases:

| Line | Element | Reason |
|---|---|---|
| 799 | `ActivityIndicator` | loading spinner |
| 805, 977, 1136 | `RefreshControl tintColor` (×3) | pull-to-refresh spinner tint |
| 1402 | `matchCard` border | border highlight on a card signaling "matches your interests" — the card itself isn't the tap target (a nested `TouchableOpacity` on the title is); this is a passive signal border |
| 1420 | `matchBadgeText` | "Matches your interests" pill text, non-tappable badge |
| 1430 | `styles.time` (×3 call sites: 889, 1049, 1214) | the gathering's scheduled date/time, colored coral purely for emphasis — a stat highlight, not a link |

Notable: `styles.time` (the scheduled-date text) is coral on every one of the three list-card
layouts (nearby/attending/hosting) purely to draw the eye to a date — a plain informational
field, not a link or button. Worth flagging as a real "coral used for emphasis, not action"
pattern, consistent across all three tabs (so at least it's not internally inconsistent — see
Batch flag below for the cross-file version of this pattern).

### BusinessDashboardScreen.js: 22 total — 12 actionable, 10 decorative, 0 borderline

Decorative cases:

| Line | Element | Reason |
|---|---|---|
| 489, 695 | `ActivityIndicator` (×2) | loading spinners |
| 1210 | `statNumber` | stat-grid number highlight (followers/redemptions count) |
| 1228 | `offerRedemptionCount` | redemption-count stat under an offer card |
| 1230 | `estimatedOwedBanner` border | border/tint on the "estimated amount owed" info card — the card displays a number, it isn't itself a CTA |
| 1233 | `estimatedOwedLabel` | "ESTIMATED AMOUNT OWED" label text inside that same info card |
| 1237 | `insightsCard` border | border/tint on a static insights-text card, no tap action |
| 1241 | `breakdownText` | reused across 6 call sites (offer title tags, community member counts, gathering-type tags, visit breakdowns) — all plain informational text, never tappable |
| 1253 | `growthCard` border | border/tint on the month-over-month growth stats card, informational only |
| 1259 | `messageBubbleFromBusiness` background | the business owner's own sent-message chat bubble — flagged as **BORDERLINE** below, not clean decorative |

Borderline: **1259, `messageBubbleFromBusiness`** — tinting "my own sent message" bubbles in the
brand color is a common, deliberate chat-UI convention (distinguishing your bubbles from theirs),
not really "decoration" in the same sense as a badge or stat, but it also isn't marking anything
tappable — the message has already been sent. Bucketed as decorative by the strict rubric but
flagged separately since it may be an intentional design choice worth keeping as-is regardless of
the broader "coral = action" push.

Notable: three separate info-card borders in this one file (`estimatedOwedBanner`,
`insightsCard`, `growthCard`) all use the identical `backgroundColor: colors.primaryMuted,
borderWidth: 1, borderColor: colors.primary` treatment on cards that only ever display numbers/
text — none are tappable. This is a real, consistent pattern of using the coral-bordered-card
treatment as a generic "this is an important stat" visual signal, unrelated to any action — the
single biggest concentration of decorative coral in this batch.

### HomeScreen.js: 20 total — 16 actionable, 4 decorative, 0 borderline

Decorative cases:

| Line | Element | Reason |
|---|---|---|
| 177 | `ActivityIndicator` | loading spinner |
| 195 | `RefreshControl tintColor` | pull-to-refresh spinner tint |
| 632 | `insightLine` | the one-sentence "AI insight" text at the top of Home — plain text, not tappable |
| 670 | `continueCommunityDetail` | "N new messages in the last day" detail line inside the tappable community card |

Flagged inconsistency: **670**, `continueCommunityDetail`. The `continueCommunityCard` itself is
one big `TouchableOpacity` (navigates to the community), but inside it `continueCommunityName`
(the actual community name, the primary label) is `colors.textPrimary` — neutral — while the
secondary "N new messages" detail line underneath it is colored coral. That's coral used to
highlight a stat (message count) rather than the thing you're actually tapping (the community
name/card). A reader's eye is drawn to the stat, not the actionable label — the reverse of what
"coral = action" would suggest.

Everything else in this file that carries coral is on a genuinely whole-tappable-surface
(`perksBanner`/`pendingInvitesBanner`/`bestPickCard`, each a single `TouchableOpacity` whose
border+text+arrow are all coral) or on a real link/button (`seeAllPlansText`, `recapLink`,
`browseButtonText`, `quickPicksEditLink`, FAB, quick-action chip icons) — counted actionable per
the note at the top of this section.

### DiscoveryScreen.js: 18 total — 14 actionable, 4 decorative, 0 borderline

Decorative cases:

| Line | Element | Reason |
|---|---|---|
| 655 | `RefreshControl tintColor` | pull-to-refresh spinner tint |
| 900 | `calloutBanner` border | border/tint on the "New: tap Browse..." tip banner — the banner itself isn't tappable, only the separate "Got it" dismiss text inside it is |
| 902 | `calloutText` | the tip's body text |
| 958 | `sharedText` | "✨ You both like X, Y, Z" shared-interest line on a person card — informational, not tappable |

Notable: the compatibility badge (`compatibilityColor()`, line 404, used at 708/713) is genuinely
actionable — the badge itself is a `TouchableOpacity` opening the compatibility report — so
despite looking like a plain stat/score readout, it correctly earns coral. Good example of the
distinction working as intended elsewhere in the same screen where `sharedText` (a very similarly
"about this match" styled line right next to it) does not earn coral treatment — and doesn't have
coral, which is actually consistent, not a bug.

### CreateGatheringScreen.js: 17 total — 13 actionable, 4 decorative, 0 borderline

Decorative cases:

| Line | Element | Reason |
|---|---|---|
| 399, 509 | `ActivityIndicator` (×2) | loading spinners |
| 778 | `progressDotActive` | the step-wizard progress dots at the top (Step 1/2/3/4/5/6) — plain `View`s, not tappable, can't jump to a step by tapping |
| 780 | `progressLabelActive` | the current step's label text in that same progress row, also non-tappable |

Notable: the wizard's progress-dot row is the one place in this file where coral is used purely
as a "you are here" indicator rather than a control — matches the rubric's explicit
"progress-bar fill" decorative example almost exactly. Every other coral usage in this file
(selected chips, selected option cards, selected location-mode toggle, selected date/time preset,
the checkmark on a selected item, "Adjust"/"drop a pin"/"More options" links, the Next button) is
on a real `TouchableOpacity` that does something. This file is the cleanest of the five audited —
only the passive progress indicator breaks the pattern.

## Batch 1 cross-file observations

- **The "info-card border" pattern is the single most common decorative use across this batch**:
  `colors.primaryMuted` background + `colors.primary` 1px border on a static, non-tappable
  info/stat card appears in `BusinessDashboardScreen.js` (3×: estimated-owed, insights, growth
  cards) and `DiscoveryScreen.js` (1×: the tip callout). It reads as a deliberate "this card is
  important" visual convention rather than scattered one-offs, but it's applied to cards that
  have zero tap action — a strong, consistent decorative pattern that would be the highest-value
  place to reconsider if "coral = action only" becomes a hard rule.
- **Stat/count highlighting in coral recurs across every file**: `GatheringsScreen.js`'s
  `styles.time` (scheduled date), `BusinessDashboardScreen.js`'s `statNumber`/
  `offerRedemptionCount`/`estimatedOwedLabel`/`breakdownText`, `HomeScreen.js`'s
  `continueCommunityDetail`, `DiscoveryScreen.js`'s `sharedText` — none are tappable, all use
  coral purely to draw attention to a number or fact. This is the second major decorative
  category and is consistent enough across files that it looks like house style, not a mistake —
  worth a product decision either way rather than a one-off fix.
- **Loading spinners** (`ActivityIndicator`/`RefreshControl tintColor`) are coral in every single
  file in this batch (10 occurrences total) — completely consistent, low-stakes, and arguably
  fine to leave as-is regardless of the "action only" push, since a spinner has no real
  alternative color convention in this app.
- **No hard actionable/decorative contradictions found within a single file** (e.g. two
  visually-identical elements where one is coral-as-CTA and the other is coral-as-decoration
  right next to each other) — the closest is `HomeScreen.js`'s `continueCommunityDetail` (flagged
  above), where the *actionable* label is neutral-colored but the *decorative* detail line is
  coral, which is backwards from what "coral = action" would predict, even though it's not
  strictly a same-element inconsistency.
