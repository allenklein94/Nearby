// Dating-discovery matching preferences -- deliberately separate from
// GENDER_IDENTITY_OPTIONS (constants/genderOptions.js), which is "how I
// identify" on the profile itself. These two are only ever used to match
// against another person's own "Show Me" preference (SettingsScreen.js's
// own established distinction), and are shared between SettingsScreen's
// full "Discovery Preferences" section and DiscoveryPreferencesPromptModal's
// smaller first-open version so neither can drift out of sync with the
// other's option list.
export const DISCOVERY_GENDER_OPTIONS = ['Men', 'Women', 'Other', 'Prefer not to say'];
export const SHOW_ME_OPTIONS = ['Men', 'Women', 'Everyone'];
