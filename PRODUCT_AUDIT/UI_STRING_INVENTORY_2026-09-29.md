# Hard-coded English UI string inventory (2026-09-29)

Method: every file in src/screens, src/components, src/motion parsed with @babel/parser; counted JSX text, text-bearing props
(placeholder, title, label, accessibilityLabel/Hint, message...), string/template literals rendered inside JSX, and the
title/message/button text of Alert.alert / showSuccessToast / presentRecoverableError. Strings already going through t() are not counted.

## Buckets
| Bucket | Hits | Decision |
|---|---|---|
| Consumer screens/components (136 files) | 4115 | translate |
| Business experience (dashboard, AI automation/assistant, business apply + application status, business chat, web home, hours editor, sponsored promotions, Tell Nearby, business email/notification prefs, demand card, setting-conflict notice) | 1445 | keep English (separate decision) |
| Admin / internal (Admin*, Market Validation) | 165 | keep English (staff tooling) |
| Legal screen | 1 | keep English (legal text needs counsel, not machine translation) |

Consumer hits by kind: JSX text 1419, props 1184 (mostly screen-reader labels), expressions 902, alerts 465, alert buttons 145.

## Outside screens (not in the 4115)
Shared modules that compose visible copy: ~168 phrase literals in src/utils (primaryAction labels, action confirmations, offer copy,
request timeline, recoverable-error copy, time/when wording, meet-tonight, load notices), ~274 in src/constants (emptyStates registry,
option labels; many option vocabularies are already translated under vocab), ~169 in src/services (some are UI copy, some are AI prompts,
logs or push bodies built server-side, which are NOT UI and stay as is).

## Never translated (data, not UI)
Business titles, people's names, user-generated text (gathering titles/descriptions, messages, notes), stored canonical values
(tags, keys, occasions), server-sent push bodies (composed in SQL, a separate server-side decision).

## Consumer files by hit count
| File | Hits |
|---|---|
| screens/BusinessRequestDetailScreen.js | 222 |
| screens/GroupOccasionPlanScreen.js | 207 |
| screens/SettingsScreen.js | 184 |
| screens/HomeScreen.js | 171 |
| screens/CelebrateSomethingScreen.js | 156 |
| screens/CreateGatheringScreen.js | 155 |
| screens/ProfileScreen.js | 155 |
| screens/GatheringDetailScreen.js | 154 |
| screens/DiscoverHubScreen.js | 152 |
| screens/CommunityDetailScreen.js | 132 |
| screens/OccasionsScreen.js | 128 |
| screens/ChatScreen.js | 103 |
| screens/GroupPlanScreen.js | 98 |
| screens/GatheringsScreen.js | 96 |
| screens/EditGatheringScreen.js | 79 |
| screens/GatheringHubScreen.js | 79 |
| screens/AskBusinessScreen.js | 77 |
| screens/DiscoveryScreen.js | 68 |
| screens/PlanDetailScreen.js | 66 |
| screens/FriendsScreen.js | 52 |
| screens/ActivityScreen.js | 51 |
| screens/BusinessProfileScreen.js | 49 |
| screens/DatingPreferencesScreen.js | 49 |
| screens/DateProposalScreen.js | 47 |
| screens/ViewProfileScreen.js | 46 |
| screens/GatheringConfirmationScreen.js | 44 |
| screens/ChemistryDiaryListScreen.js | 43 |
| screens/CompleteProfileScreen.js | 37 |
| screens/FriendDiscoveryScreen.js | 34 |
| screens/BillingScreen.js | 33 |
| screens/BrandOffersScreen.js | 32 |
| screens/MomentumScreen.js | 32 |
| screens/MatchesScreen.js | 29 |
| screens/CreateCommunityScreen.js | 27 |
| screens/OnboardingQuestionsScreen.js | 27 |
| components/FiltersModal.js | 27 |
| screens/EditCommunityScreen.js | 26 |
| screens/RelationshipLegacyScreen.js | 26 |
| screens/RequestBusinessPartnerScreen.js | 26 |
| screens/PaywallScreen.js | 25 |
| screens/SelectGatheringLocationScreen.web.js | 23 |
| screens/EmergencyContactsScreen.js | 22 |
| screens/GoodbyeArchiveListScreen.js | 22 |
| components/PhotoLightbox.js | 22 |
| screens/CommunityChatScreen.js | 21 |
| components/GatheringQnA.js | 21 |
| screens/MakeAPlanScreen.js | 20 |
| screens/PlacesScreen.js | 20 |
| components/CompatibilityReportModal.js | 20 |
| screens/CreateHubScreen.js | 19 |
| screens/GatheringChatScreen.js | 19 |
| components/DateCheckInModal.js | 19 |
| components/ExperienceSharePanel.js | 19 |
| components/HostAttendeeManager.js | 19 |
| components/StoryViewerModal.js | 19 |
| screens/GoodbyeArchiveEntryScreen.js | 18 |
| components/DatingPreferencesPromptModal.js | 17 |
| screens/MusicModeScreen.js | 16 |
| screens/PlanChatScreen.js | 16 |
| screens/SelectGatheringLocationScreen.js | 16 |
| screens/SharedNightScreen.js | 15 |
| components/ReportBlockModal.js | 15 |
| screens/RewardsScreen.js | 14 |
| components/ExperienceComponentList.js | 13 |
| components/GatheringFeedbackModal.js | 13 |
| screens/ChemistryDiaryEntryScreen.js | 12 |
| screens/RehearsalRoomScreen.js | 12 |
| screens/SharedPlaylistScreen.js | 12 |
| components/OfferOutcomeModal.js | 12 |
| screens/CommunitiesScreen.js | 11 |
| screens/PlansScreen.js | 11 |
| components/GatheringsMapView.js | 11 |
| components/InviteFriendsModal.js | 11 |
| components/SwipeableDiscoveryCards.js | 11 |
| motion/MatchAnimation.js | 11 |
| components/AcceptedBusinessOfferCard.js | 10 |
| components/AgeRangePicker.js | 10 |
| screens/IdVerificationScreen.js | 9 |
| screens/MemoryVaultIndexScreen.js | 9 |
| screens/MessagesScreen.js | 9 |
| screens/OnboardingRecommendationsScreen.js | 9 |
| components/QuickPicksEditModal.js | 9 |
| screens/BlockedUsersScreen.js | 8 |
| screens/RelationshipToolsScreen.js | 8 |
| components/FriendDiscoverySwipeCards.js | 8 |
| components/SponsoredCard.js | 8 |
| screens/SharedDecisionsScreen.js | 7 |
| components/DiningPreferencesPromptModal.js | 7 |
| components/PlanCompletionRow.js | 7 |
| components/RecommendationCustomizePanel.js | 7 |
| screens/LoginScreen.js | 6 |
| screens/MemoryVaultScreen.js | 6 |
| screens/OnboardingLocationScreen.js | 6 |
| screens/OnboardingScreen.js | 6 |
| screens/QuickFilterCustomizeScreen.js | 6 |
| screens/RelationshipConstitutionScreen.js | 6 |
| screens/StressTestScreen.js | 6 |
| screens/TimelinePlannerScreen.js | 6 |
| screens/TripPlanningScreen.js | 6 |
| components/DraftBanner.js | 6 |
| components/GatheringIntentModal.js | 6 |
| components/TabHeaderActions.js | 6 |
| screens/InviteFriendsScreen.js | 5 |
| screens/LegacyLibraryScreen.js | 5 |
| screens/OnboardingNotificationsScreen.js | 5 |
| screens/OnboardingOccasionsScreen.js | 5 |
| screens/PreferencePollScreen.js | 5 |
| screens/TimelineScreen.js | 5 |
| components/GatheringFeedbackPrompt.js | 5 |
| components/OnboardingTopBar.js | 5 |
| components/SightingMapModal.js | 5 |
| screens/FeaturesOverviewScreen.js | 4 |
| components/FriendInviteSelector.js | 4 |
| components/LoadErrorState.js | 4 |
| components/OfferMedia.js | 4 |
| components/StartSomethingModal.js | 4 |
| screens/RelationshipEmergencyKitScreen.js | 3 |
| components/CommunityCalendar.js | 3 |
| components/GifPickerModal.js | 3 |
| components/CancellationReasonSheet.js | 2 |
| components/DietaryPicker.js | 2 |
| components/NewcomerBadge.js | 2 |
| components/OccasionPlanShareCard.js | 2 |
| components/OfferCustomerBody.js | 2 |
| components/RequestedItemsPicker.js | 2 |
| components/SightingsOverviewMap.js | 2 |
| components/SponsoredSpotlightSlot.js | 2 |
| components/SurpriseMeSheet.js | 2 |
| components/VoicePlayButton.js | 2 |
| motion/SuccessToast.js | 2 |
| screens/RelationshipHubScreen.js | 1 |
| components/ActionSheetModal.js | 1 |
| components/BusinessHostBadge.js | 1 |
| components/ExperiencePerkLine.js | 1 |
| components/PersonCard.js | 1 |
| motion/NLoader.js | 1 |
