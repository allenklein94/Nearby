// Build 87 Tier 1 fix (2026-11-22): iOS labels a pushed screen's back button with the previous screen's title. Every
// screen above the tabs is pushed over the tab container (MainTabs), which had no title, so the button read "MainTabs".
// The container's title is now the label of the tab the person was on, so the button reads "‹ Profile", "‹ Home"...
// Returns the translation key; no tab state yet (first render) = Home, the initial tab.
export const MAIN_TAB_NAMES = ['Home', 'Discover', 'Create', 'Activity', 'Profile'];

export function mainTabsBackTitle(focusedTab) {
  const tab = MAIN_TAB_NAMES.includes(focusedTab) ? focusedTab : 'Home';
  return `ui.nav.tab.${tab.charAt(0).toLowerCase()}${tab.slice(1)}`;
}
