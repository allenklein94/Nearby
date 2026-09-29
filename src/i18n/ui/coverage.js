// Localization pass 5 coverage: the files whose ordinary UI text is fully localized, and the English kept on purpose in each
// (with the reason). uiInventory.test.js fails if a listed file has any English literal not listed here.
// Files NOT listed are either not converted yet or deliberately English (NOT_LOCALIZED below).
export const LOCALIZED_FILES = [
  'src/screens/PlansScreen.js',
  'src/components/LoadErrorState.js',
  'src/components/DraftBanner.js',
  'src/components/OnboardingTopBar.js',
  'src/components/TabHeaderActions.js',
  'src/components/GatheringStatusBadge.js',
  'src/constants/planStatus.js',
  'src/utils/recoverableError.js',
  'src/components/EmptyCopy.js',
  'src/utils/actionConfirmations.js',
  'src/screens/HomeScreen.js',
  'src/utils/homeQuiet.js',
  'src/utils/meetTonight.js',
  'src/utils/homeLoadNotice.js',
  'src/utils/firstRunInterests.js',
  'src/utils/upcomingWorld.js',
  'src/utils/occasionRecall.js',
  'src/utils/gatheringFullness.js',
  'src/screens/DiscoverHubScreen.js',
  'src/screens/GatheringsScreen.js',
  'src/screens/GatheringDetailScreen.js',
  'src/screens/CreateGatheringScreen.js',
  'src/screens/EditGatheringScreen.js',
  'src/screens/ActivityScreen.js',
  'src/utils/offerCopy.js',
  'src/utils/inviteExpiry.js',
];

// Exact strings that stay English in a localized file, with why (brand names, data, internal ids...).
export const INTENTIONAL_ENGLISH = {
  '*': {
    Nearby: 'the app name',
  },
  'src/utils/meetTonight.js': {
    'Go on dates': 'stored onboarding token (profiles.onboarding_motivations), matched, never shown',
    'Make new friends': 'stored onboarding token, matched, never shown',
    'Meet new people': 'stored onboarding token, matched, never shown',
  },
  'src/utils/actionConfirmations.js': {
    'Offer saved': 'business-side confirmation (business experience stays English)',
    "We're checking it now. It goes to the customer as soon as it clears.": 'business-side confirmation',
  },
  'src/utils/recoverableError.js': {
    "We couldn't {} right now.": 'fallback frame for an action phrase with no ui.shared.errors.what entry (the phrase itself is English)',
    "We couldn't {}. Please check it and try again.": 'same fallback, input form',
  },
};

// Deliberately not localized in this pass (owner decisions, 2026-09-29).
export const NOT_LOCALIZED = {
  business: 'The business experience is a separate decision: BusinessDashboard, BusinessAIAutomation, BusinessAIAssistant, BusinessPartnerApply, MyBusinessApplication, BusinessConversation, BusinessWebHome, and the business-only components (BusinessHoursEditor, SponsoredPromotionsPanel, TellNearbyBusinessCard, BusinessEmailNotifications, BusinessNotificationPreferences, DemandNearYouCard, SettingConflictNotice).',
  admin: 'Staff tooling: Admin* screens, MarketValidation.',
  legal: 'Legal text needs counsel, not machine translation: LegalScreen, sponsored terms.',
  data: 'Business titles, people\'s names, user-generated text, stored canonical values, server-composed push bodies.',
};
