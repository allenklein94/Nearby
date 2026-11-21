# UX consistency audit (read-only), 2026-11-21

Main = b69e591e (build 87 source + the 5 UX P0/P1 fixes). Nothing edited. Top findings spot-checked by hand.

## Recommended before Tier 1 (small, shared-component, owner approval needed)
1. Keyboard offset: 10 screens have a KeyboardAvoidingView with no header offset (same bug as the chats): BusinessAIAssistant:35 (bottom composer), RehearsalRoom:128 (composer), AskBusiness:639, CelebrateSomething:1132, DateProposal:297, RequestBusinessPartner:143, Occasions:500, TogetherNotes:66, MemoryVault:94, RelationshipLegacy:58. Fix = swap to KeyboardSafeView.
2. Sheets with a text input and no keyboard handling: ReportBlockModal:99 (safety), OfferOutcomeModal:130, CommunityDetail area modal :853-867. Fix = one KeyboardSafeSheet (offset 0, for Modals).
3. Category-coloured CTAs left: CreateCommunity:193, EditCommunity:138 (white text on the category colour), GatheringAttendingSection:225 + :391. Fix = colors.primary like Next/Join.
4. Transparent header overlaps: GatheringPublishedPanel above GatheringDetail's hero (:757, paddingTop spacing.xl; in session A's publish step) and FriendDiscovery (RootNavigator:563). Fix = solid header / header-height padding.
5. CommunityDetail's upcoming gatherings (:829) are plain Views: no way to open them (BusinessProfile:628 links). Candidate for the owner's community "can't find the gathering" report.

## Defer until phone evidence (wider or riskier)
- Forms with no keyboard handling at all (CreateGathering description, EditGathering, Create/EditCommunity, BusinessPartnerApply, DatingPreferences, EditProfile, GroupPlan, BusinessRequestDetail timeline, GatheringQnA, onboarding/login).
- Alert-only validation (EditGathering, Create/EditCommunity, AskBusiness `findMissingField`, CompleteProfile, BusinessPartnerApply "Add a short description above"): extract CreateGathering's scroll+focus into one hook later.
- ~70 service reads log + return [] on error, so lists say "none" instead of Try Again (getCommunityGatherings, getCommunityMembers, getMyFriends, getMyOccasions, ...). Medium-high regression risk (callers rely on []).
- Unvirtualized .map lists (CommunityDetail members/gatherings, Messages groups, Occasions, diaries, admin).
- Missing labels: FriendDiscovery:331 + BusinessAIAutomationPanel:598 switches; "OK"/"Done" buttons (SelectGatheringLocation:122, FriendsScreen:508, InviteFriendsModal:184); icon-only touchables (Chat voice/media, GIF tiles, playlist +, Home 8, ReportBlockModal 4, DateCheckInModal 4).
- Minor: GatheringDetail joinButtonText still CATEGORY_BUTTON_TEXT_COLOR (dark) on coral; Next uses white.
- Non-tappable rows: community members, GroupPlan participants, own availability postings.

No dead Settings rows found.

## Community edit report
No "can't find this gathering" text exists; the nearest are GatheringDetail "This gathering isn't available anymore." and CommunityDetail's unavailable state. EditCommunity saves via update_community and goes back (CommunityDetail reloads on focus). Gaps found: community gatherings aren't tappable (above); getCommunityGatherings returns [] on any error (shows "no upcoming"). Exact steps still needed.

## Implemented on `post-tier1/ux-audit-fixes` (owner approved 2026-11-21; NOT merged, NOT in a build yet)
Items 1-5 above; inline missing-field errors on the 7 alert-only forms (Create/Edit Community, EditGathering, AskBusiness, CompleteProfile, BusinessPartnerApply, EditProfile) via one hook `useFormErrors` + `FieldError` (first problem scrolled into view, focused when it is a text field, inline message, entries kept; item 84's marks + Send alert kept as backstop); the labels/roles listed under "Missing labels". Guard `screens/uxAuditFixes.test.js`. NOT DEVICE-VERIFIED: keyboard on full screens vs sheets, header spacing, CTA contrast, community rows.

## Failed read shown as "nothing" (proposal only, nothing changed)
Not a blanket change to the ~70 reads. Highest risk = an empty result that tells the person something false and makes them act (or not act) on it:
1. `getPendingFriendRequests` (friends.js) -> Activity / Friends say no requests while some wait.
2. `getGatheringRequestsForHost` + `getAllPendingRequests` (gatherings.js) -> a host sees no join requests and never approves anyone.
3. `getCommunityGatherings` (communities.js) -> "no upcoming gatherings" (matches the owner's community report).
4. `getMyFriends` (friends.js) -> invite sheet "No friends to invite yet" (wrong empty state, C26).
5. `getMyInterestedGatherings` (gatherings.js) -> Plans' Interested row disappears.
Proposed fix per case: a sibling read returning `{ data, error }` (the existing function kept for every other caller, so nothing relying on `[]` changes), adopted only by that one screen, which shows the existing `presentRecoverableError` Try Again instead of the empty state. One case per commit, each with a test that a failed read renders Try Again, never the empty state. Needs owner approval; suggested after Tier 1 unless Tier 1 shows one of these.

## Separate UX plan (owner, 2026-11-21: wanted, NOT before build 87, no uncontrolled redesign)
Discover clutter; very long interests lists; business-profile editing that feels overwhelming; Settings clarity; Quick Picks. Direction: one consistent design system (shared form validation = `useFormErrors`, clear selection states, predictable coral primary actions, organized categories, progressive disclosure for advanced options, reusable layouts). Each area gets its own scoped proposal from Tier 1 phone evidence, owner-approved before any build.

## Consistency pass, items 1-3 (owner approved 2026-11-21) on `post-tier1/ux-consistency` (NOT merged, NOT in a build, NOT DEVICE-VERIFIED)
1. `components/TagGroupPicker.js` (+ `utils/tagGroups.js`) replaces the six flat 256-chip lists (Profile interests, Create/Edit Community category, Quick Picks, Friends interest filter, business AI rule category): "N selected" summary on top (tap to remove), search (shown label or key, accent-insensitive), the existing 19 groups as collapsible headers, groups holding a selection open. Display only: same options, taxonomy, saved values, toggles; Quick Picks keeps its cap of 5 (capped chips show disabled) and its sheet is now keyboard-safe. 6 new `ui.tagPicker.*` strings (10 languages machine-authored, need native review). Community chips lost their category colour/photo (selected = coral, like every other picker). Guard `utils/tagGroups.test.js`.
2. `components/ToggleRow.js`: 24 switch rows toggle from anywhere on the row; the switch inside only shows the state (no touches, hidden from screen readers) so one tap = one toggle; announced as a switch with on/off; coral "on" track everywhere. Kept as a plain switch (row holds something a whole-row tap would collide with or make risky): a live offer's on/off on the business dashboard, Quick Filter rows (move buttons), the sponsored-places row (Reset link), the Friends header toggle. Guard `utils/toggleRow.test.js`.
3. `constants/buttonStates.js` `disabledButtonStyle`: 114 coral buttons that can be disabled show one muted grey while disabled (82 had no disabled look, mostly while saving/sending; 32 faded the coral). Visual only. Guard `constants/buttonStates.test.js`. Primary = coral + white text was already guarded by `screens/uxAuditFixes.test.js`.
Phone checks: the picker's length/scrolling inside Profile edit and the Quick Picks sheet; group headers readable in a longer language; rows toggle once (tap on the switch itself too) with VoiceOver on and off; the grey disabled look is readable in light and dark and never mistaken for an active button; a button greying for the moment it is saving doesn't read as an error.
