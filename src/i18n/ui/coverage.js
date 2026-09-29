// Localization pass 5 coverage: the files whose ordinary UI text is fully localized, and the English kept on purpose in each
// (with the reason). uiInventory.test.js fails if a listed file has any English literal not listed here.
// Files NOT listed are either not converted yet or deliberately English (NOT_LOCALIZED below).
export const LOCALIZED_FILES = [
  'src/screens/PlansScreen.js',
];

// Exact strings that stay English in a localized file, with why (brand names, data, internal ids...).
export const INTENTIONAL_ENGLISH = {
  '*': {
    Nearby: 'the app name',
  },
};

// Deliberately not localized in this pass (owner decisions, 2026-09-29).
export const NOT_LOCALIZED = {
  business: 'The business experience is a separate decision: BusinessDashboard, BusinessAIAutomation, BusinessAIAssistant, BusinessPartnerApply, MyBusinessApplication, BusinessConversation, BusinessWebHome, and the business-only components (BusinessHoursEditor, SponsoredPromotionsPanel, TellNearbyBusinessCard, BusinessEmailNotifications, BusinessNotificationPreferences, DemandNearYouCard, SettingConflictNotice).',
  admin: 'Staff tooling: Admin* screens, MarketValidation.',
  legal: 'Legal text needs counsel, not machine translation: LegalScreen, sponsored terms.',
  data: 'Business titles, people\'s names, user-generated text, stored canonical values, server-composed push bodies.',
};
