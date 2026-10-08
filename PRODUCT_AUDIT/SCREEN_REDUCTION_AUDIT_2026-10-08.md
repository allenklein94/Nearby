# Screen-Reduction Audit (CLAUDE.md item 45), 2026-10-08

Audit only. No code, route or test was changed. Every finding below comes from reading the navigators,
`src/constants/screenRegistry.js`, `src/navigation/notificationDestinations.js`, and the screen files themselves
(inbound references found by grep over `src/`, excluding tests). Nothing was run on a device or in a browser.

The question for every screen: **do we need this screen at all?**

---

## A. Executive summary

- **Routes inventoried: 90** = 87 registered screens + `MainTabs` + 2 outside-entry presentations (`Notices` =
  Activity, `FriendDiscovery` = Discover -> People -> Friends). Two more screen components render embedded only
  (`MatchesScreen` inside Messages, `DiscoveryScreen` inside Discover -> People -> Dating). The business website
  registers 18 of the same routes (`BusinessWebNavigator.js`).
- **Verified disconnected (no way in): 0.** Every route has at least one real entry point. The 12 that look
  orphaned are reached by onboarding flow, the auth gate, a tab, a push (`notificationDestinations.js`) or a
  Settings list driven by a `route:` field rather than a `navigate('X')` call. The Rule 14 pass on 2026-10-04 already
  removed the truly dead ones.
- **Duplicate destinations: 5 confirmed.**
  1. One gathering has two screens: `GatheringDetail` and `GatheringHub`. Joining *replaces* Detail with Hub.
  2. One gathering, request or match also opens `PlanDetail`, a third summary whose main buttons lead back.
  3. Two gathering browse surfaces with different filters and different ranking: `Gatherings` and Discover -> Gatherings.
  4. Two gathering-creation flows: `MakeAPlan` and `CreateGathering`. `MakeAPlan` skips the required category.
  5. Five near-identical "notes we write together" screens.
- **Recommended:** 6 CONSOLIDATE, 4 INLINE, 0 REMOVE right now (removal of the private relationship tools is a product
  decision -> INVESTIGATE), 6 INVESTIGATE, rest KEEP.
- **Highest-impact problems:**
  1. Joining a gathering moves you off its detail screen onto a second screen of the same gathering (P1).
  2. `MakeAPlan` is a second creation flow that bypasses item 64's required category (P1, partly a defect).
  3. Two gathering feeds that can rank the same gathering differently (P1).
  4. `PlanDetail` loops between a gathering/request and itself (P1).

No P0 (broken navigation or a privacy leak) was found.

---

## B. Findings (every non-KEEP disposition, plus KEEPs worth stating)

Confidence: **H** = read the code path end to end; **M** = read entry points and the screen's sections, not every branch.

### B1. GatheringHub -> CONSOLIDATE into GatheringDetail (P1)
- **Files:** `src/screens/GatheringHubScreen.js` (642 lines); `GatheringDetailScreen.js:406` (`navigation.replace('GatheringHub', { justJoined: true })`), `:1090`, `:1134`.
- **Entry:** joining a gathering (replaces Detail), and two "Hub" links on Detail. No push opens it.
- **What it holds:** "You're in" + invite/share, who's here / who you'll meet with Send notice, ice breakers, meet-up
  point, "I'm on my way", check in, group chat link, "View full details" (back to Detail).
- **Why it fails item 45:** same object, same job (being an attendee of THIS gathering). Item 39 says a gathering is
  ONE object with one detail screen whose content follows your relationship to it. Because of the `replace`, after
  joining, Back skips the gathering you just joined.
- **Proposal:** Detail renders an "attending" block (the day-of sections) when the viewer is attending. The post-join
  "You're in" becomes an inline confirmation there. Retire the route.
- **Risk:** M-H. This is the biggest single move. Detail is already long (host command center, business blocks).
  It needs a layout pass so the attending block does not bury the decision content, the per-attendee Send notice
  moves with it, and `hostControlsOnDetailGuard` / journeys need extending.
- **Conflict:** the Rule 14 pass (2026-10-04) KEPT the Hub "only fold if a later review shows Detail can carry it".
  This audit is that review. **Your call.** Confidence H.

### B2. PlanDetail for single-object plans -> CONSOLIDATE (stop linking to it) (P1)
- **Files:** `PlanDetailScreen.js`. Links: `GatheringDetailScreen.js:667` ("the whole plan"), `BusinessRequestDetailScreen.js:990`,
  `ChatScreen.js:574` ("Our plan"), `OccasionsScreen.js:109`, `ExperienceComponentList.js:49`, `PlansScreen.js:344` (night-out rows).
- **What it holds:** the plan's people, offers, reservation, and buttons "Open the gathering" / "Open the request".
  For a gathering, request or match plan, that duplicates the object's own screen and its buttons lead straight back.
- **Proposal:** keep `PlanDetail` ONLY for plans that combine several objects (experience nights with stops,
  occasion parent plans). Remove the "whole plan" links from GatheringDetail, BusinessRequestDetail and Chat's
  "Our plan". Anything PlanDetail shows that the object screen lacks goes onto that screen, in its existing sections.
- **Risk:** M. Items 141-146 built the plan read layer and these links on purpose. Before removing, check whether
  any field (e.g. invited-by-link guests on a gathering plan) is shown nowhere else. Confidence M.

### B3. Gatherings feed vs Discover -> Gatherings -> CONSOLIDATE (staged) (P1)
- **Files:** `GatheringsScreen.js` (1244 lines); `DiscoverHubScreen.js` (`TYPE_FILTERS` gatherings tab).
- **Entry to Gatherings:** Home Quick Picks (`HomeScreen.js:980`, with category/date/search), Home Quick Stats
  "N gatherings today" (`utils/homeQuiet.js:15`), Momentum, the post-event feedback modal, the destination contract,
  and 3 push types.
- **Why it fails item 45:** both answer "what gatherings are near me". The ranking differs: `rankGatheringFeed` vs
  Discover's `compareDiscover`, and the filters differ: price, plan kind, For You, Trending and morning/afternoon on
  one side; sections, date view, Open now and the category view on the other. So two screens can disagree about the
  same gatherings, which also violates master principle 2. Home's Quick Picks navigate to a pre-filtered feed, which
  is a filter that navigates.
- **Proposal, staged:**
  1. Point the Home/Momentum/feedback/push entries at Discover (Gatherings tab or the in-place date/category view).
  2. Move any filter Discover lacks and real people use into Discover's in-place controls.
  3. Retire the `Gatherings` route.
- **Risk:** H (largest file, its own ranking surface in `SURFACE_PIPELINE`, guard tests, 3 push destinations, items
  137b `tonight`/`morning` filters). Needs a decision on which filters survive. Confidence H on duplication, M on the plan.

### B4. MakeAPlan -> CONSOLIDATE into CreateGathering (P1, includes a defect)
- **Files:** `MakeAPlanScreen.js`. Entry: Home perk row "Make a plan" (`HomeScreen.js:498`), Home recall (`:1446`),
  BusinessProfile x2 (`:442`, `:478`), 1 push type.
- **Why:** a second gathering-creation flow (title, when, invite friends, then `createGathering` and GatheringConfirmation)
  for "at this business". CreateGathering already has the place step and (item 109) an invite step.
- **Defect (confirmed, MakeAPlanScreen.js:155-163):** it creates with `interestTag: offer?.target_interest_tag ?? null`,
  so from a business with no perk the gathering has NO category. That breaks item 64's required category and starves
  routing, recommendations and demand. It also skips Settings (visibility, approval, capacity are hard-coded `isPublic: true`).
- **Proposal:** these entries open CreateGathering prefilled (place = the business, title, category = the business's
  or the perk's tag when real, invite step on). Retire the route; reroute its push.
- **Risk:** M. CreateGathering's invite step currently appears only when the ask said who (item 109). This entry would
  need to turn it on. Confidence H.

### B5. GatheringConfirmation -> INLINE into GatheringDetail (P2)
- **Files:** `GatheringConfirmationScreen.js` (380 lines); reached by `replace` from CreateGathering and MakeAPlan; also registered on the business website.
- **What it holds:** "Your gathering is live", share, invite connections and circles, "we invited N of M", Done -> Detail.
- **Why:** it is a post-publish confirmation for the object whose detail screen you land on next, and Detail already has
  Invite (host command center, `InviteFriendsModal`). Item 45: a confirmation is not a new task.
- **Proposal:** publish -> GatheringDetail with a one-time "Your gathering is live" panel (share + invite, the "N of M"
  line). Circle invites go into the existing invite modal.
- **Risk:** M. `InviteFriendsModal` has no circles today, the share message builder moves, and the business web
  navigator registration needs updating. Confidence H.

### B6. Five shared-notes screens -> CONSOLIDATE into one component/route (P2)
- **Files:** `SharedDecisionsScreen.js`, `TimelinePlannerScreen.js`, `StressTestScreen.js`, `RelationshipConstitutionScreen.js`,
  `TripPlanningScreen.js` (145-156 lines each, same structure: categories with icon + draft input + moderated insert
  + realtime list). All are opened from Chat's "Do Something Together" menu.
- **Why:** five routes for one interaction pattern ("notes we write together, by section"). Their data tables stay separate.
- **Proposal:** one `TogetherNotes` screen with a `kind` config (sections, service pair, strings). MemoryVault and
  SharedPlaylist differ (media/tracks) and stay separate.
- **Risk:** L-M (pure UI refactor, the strings stay; check any per-kind push tap). Separate from B9's bigger question. Confidence H.

### B7. RequestBusinessPartner -> INLINE into AskBusiness (P2)
- **Files:** `RequestBusinessPartnerScreen.js` (376 lines); entry GatheringDetail `:1057`, CommunityDetail `:696`, CreateHub `:200`, `createAssistant.js:103`.
- **Why:** step 1 of a two-screen flow ("pick the business", then AskBusiness, item 111). Picking the business is part of the same request task.
- **Proposal:** AskBusiness shows a business picker (or a sheet) when started with "a specific business" and no target.
  Community targets keep the note-only path, which also lives in this screen today.
- **Risk:** M (the gathering path also sends the co-host partnership request; the community path is different). Confidence M.

### B8. Communities -> CONSOLIDATE into Profile (P3)
- **Files:** `CommunitiesScreen.js` (182 lines, trimmed 2026-10-04 to "your communities + Create"). Entry: Profile Quick Stat (`ProfileScreen.js:775`), 1 push (`community_cancelled`).
- **Why:** after the trim, it is a short list of your own communities, a section of "you".
- **Proposal:** a "Your communities" section on Profile (rows -> CommunityDetail, Create link). Reroute the push to Profile.
- **Risk:** L. Profile's seven-part order is LOCKED (2026-10-08), so this needs your OK to add a section, or fold it under Friends. Confidence H.

### B9. Private relationship tools (7 routes) -> INVESTIGATE (product decision)
- **Routes:** RehearsalRoom, ChemistryDiaryList, ChemistryDiaryEntry, GoodbyeArchiveList, GoodbyeArchiveEntry, LegacyLibrary,
  RelationshipEmergencyKit. Lists are reached only from Settings > Relationship (`SettingsScreen.js:77-81`); entries also from Chat/ViewProfile.
- **Why it's flagged:** none is part of "What do you want to do nearby?" (item 86 creep guard), and Settings is their
  only door. Two are static reading (LegacyLibrary, EmergencyKit = job F only).
- **Options:** (a) keep as is; (b) INLINE the two Entry screens as editors on their list screens; (c) remove the set.
  Removal deletes features people may use and is your call. Confidence H on reachability.

### B10. Smaller INLINE candidates (P3)
- **QuickFilterCustomize** (`QuickFilterCustomizeScreen.js`, from the Discover filters modal): a modal that opens a screen to edit chips; could be a section of that modal. Confidence M.
- **BlockedUsers** (160 lines, Settings only): could be an expandable Settings section. Confidence H.
- **BusinessAIAutomation** (from the dashboard): could be part of the dashboard's collapsed Settings on the Profile tab, like the other settings there. Business web parity applies. Confidence M.

### B11. INVESTIGATE (evidence needed, no change proposed yet)
- **DateProposal vs PlanDetail for a match:** Chat's menu has both "Our plan" (-> PlanDetail) and "Plan together" (-> DateProposal), two plan entries for one match. Resolved by B2 if adopted.
- **GroupPlan vs GroupOccasionPlan:** two group-voting screens over different tables. Same job for the person? Needs a product look; the data stays separate.
- **Momentum:** already borderline (Rule 14); revisit with usage data, possibly a Profile section (Profile's "Your activity" is LOCKED as its own section).
- **Five chat screens** (Chat, GatheringChat, CommunityChat, PlanChat, BusinessConversation): each is a different conversation, so KEEP. Worth checking that they share one component, but that is code reuse, not screen count.

### B12. KEEPs worth stating
- Tabs (Home, Discover, Create, Activity, Profile), Plans, Messages, Chat, ViewProfile, GatheringDetail, CommunityDetail, BusinessProfile,
  BusinessRequestDetail, AskBusiness, CreateGathering (+ SelectGatheringLocation: a full map is a real step), EditGathering,
  EditProfile, Settings, BusinessDashboard and the onboarding steps: each is an entity, a distinct workflow, management,
  communication or a transaction.
- `SharedNight` stays: a deliberately narrow read-only projection for a person the night was shared with (privacy boundary, item 2 of the experience arc).
- Admin screens (7) stay: back office, not product navigation.

---

## C. Prioritized recommendations

- **P0:** none found.
- **P1:**
  - **B4** MakeAPlan -> CreateGathering. Fixes the missing-category defect.
  - **B1** GatheringHub -> GatheringDetail.
  - **B2** stop linking single-object plans to PlanDetail.
  - **B3** retire the Gatherings feed in stages.
- **P2:** B5 GatheringConfirmation inline; B6 one shared-notes screen; B7 business picker inside AskBusiness.
- **P3:** B8 Communities into Profile; B10 QuickFilterCustomize, BlockedUsers, BusinessAIAutomation; B9 decision on relationship tools.

**Smallest set with the most effect:** B4 + B2 + B1. Three duplicate paths for one gathering go away, and one data defect is fixed.

---

## D. Screen disposition list (all 90 routes)

**Tabs/surfaces:** Home KEEP · Discover KEEP · Create KEEP · Activity KEEP · Profile KEEP · Plans KEEP · Gatherings CONSOLIDATE (B3)

**Onboarding/auth:** Onboarding · OnboardingQuestions · OnboardingLocation · OnboardingNotifications · OnboardingOccasions · OnboardingRecommendations · Login · CompleteProfile: all KEEP (one setup workflow)

**You:** EditProfile KEEP · Settings KEEP · DatingPreferences KEEP · QuickFilterCustomize INLINE (B10) · BlockedUsers INLINE (B10) · EmergencyContacts KEEP · Occasions KEEP · MusicMode KEEP · IdVerification KEEP · InviteFriends KEEP · Momentum INVESTIGATE · Billing KEEP · Paywall KEEP · Legal KEEP

**People:** Messages KEEP · Chat KEEP · ViewProfile KEEP · Friends KEEP · PreferencePolls KEEP (already a modal) · DateProposal KEEP (see B11)

**Together tools:** SharedDecisions, TimelinePlanner, StressTest, RelationshipConstitution, TripPlanning: CONSOLIDATE (B6) · SharedPlaylist KEEP · MemoryVault KEEP · RelationshipLegacy KEEP

**Private reflection:** RehearsalRoom · ChemistryDiaryList · ChemistryDiaryEntry · GoodbyeArchiveList · GoodbyeArchiveEntry · LegacyLibrary · RelationshipEmergencyKit: INVESTIGATE (B9)

**Gatherings:** GatheringDetail KEEP · GatheringHub CONSOLIDATE (B1) · GatheringChat KEEP · CreateGathering KEEP · EditGathering KEEP · SelectGatheringLocation KEEP · GatheringConfirmation INLINE (B5)

**Communities:** Communities CONSOLIDATE (B8) · CommunityDetail KEEP · CommunityChat KEEP · CreateCommunity KEEP · EditCommunity KEEP

**Plans/requests:** CelebrateSomething KEEP · MakeAPlan CONSOLIDATE (B4) · PlanDetail KEEP for multi-object plans, unlink elsewhere (B2) · PlanChat KEEP · SharedNight KEEP · GroupPlan KEEP / GroupOccasionPlan KEEP (B11) · AskBusiness KEEP · RequestBusinessPartner INLINE (B7) · BusinessRequestDetail KEEP · BusinessProfile KEEP · BusinessConversation KEEP

**Business:** BusinessDashboard KEEP · BusinessWebHome KEEP · BusinessAIAssistant KEEP · BusinessAIAutomation INLINE (B10) · BusinessPartnerApply KEEP · MyBusinessApplication KEEP

**Admin:** AdminReports · AdminVerification · AdminBusinessRequests · AdminBusinessTier · AdminContentReview · AdminSponsoredRefunds · MarketValidation: KEEP

**Infrastructure/presentations:** MainTabs (infrastructure) · Notices (Activity presentation) KEEP · FriendDiscovery (Friends presentation) KEEP

**Embedded components:** MatchesScreen (in Messages), DiscoveryScreen (in Discover -> People -> Dating): unchanged.

---

## E. Verification plan (before any approved removal)

1. **Registry:** move each retired route into `RULE14_DECISIONS.removed`/`folded` in `screenRegistry.js`; `screenRegistry.test.js` then fails if the route or file survives.
2. **Push destinations:** reroute every push in `notificationDestinations.js` that targets a retired route (Gatherings x3, MakeAPlan x1, Communities x1). `pushNavigationContract.test.js` checks every destination is registered. Keep the notification -> action journey green (master principle 3).
3. **Deep links:** `nearby://` gathering/business/apply links do not target any candidate; re-run the linking tests anyway.
4. **Back/state:** for B1/B5, router-level tests (as in `returnTrail.test.js` / `friendsPresentation.test.js`) that join/publish -> Back returns to the screen before the gathering. For B3, `backNavigationState.test.js` + `discoverDateView.test.js` with the new Home entries.
5. **Journeys:** core loop, offer, invite, group-plan and notification journeys must stay green; B4 adds a check that a gathering made from a business has a category.
6. **Business web:** regenerate the export after B5/B10 (both touch routes the website registers) and smoke-test in a browser.
7. **Device:** none of these flows have run on a device; the first device session should walk join -> attending view, publish -> live panel, Home Quick Pick -> Discover.

---

## F. Conflicts with the instructions given for this audit

- **"Preserve the four primary tabs: Home, Discover, Create, Activity."** Outdated. Since 2026-10-04 there are **five** tabs; Profile is the fifth (LOCKED). The audit treated five as current.
- **"Matches ... remain full-screen destinations."** There is no Matches screen: `MatchesScreen` renders inside Messages. Nothing to preserve or change.
- **GatheringHub (B1)** reverses a 2026-10-04 KEEP, and **Communities into Profile (B8)** touches the LOCKED seven-part Profile order. Both are flagged for your decision, not assumed.
