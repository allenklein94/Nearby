// Opening a recommendation (shared context layer, 2026-09-28): the ONE place a context object's `destination` is followed.
// { kind: 'navigate', screen, params } -> navigation; { kind: 'url', url } -> the OS (maps for Go now / Directions). A missing or
// malformed destination does nothing and returns false, so a card with no real destination is never a wrong screen.
import { Linking } from 'react-native';
import { beginTrail, routesAboveTabs } from '../navigation/returnTrail';

// The bottom tabs. Opening one from a screen above the tabs closes that screen; remember it (navigation/returnTrail.js) so
// Android Back / the iOS chip on that tab reopens it instead of stranding the person on the tab.
const TAB_SCREENS = new Set(['Home', 'Discover', 'Create', 'Activity']);

function rootState(navigation) {
  let n = navigation;
  while (n?.getParent?.()) n = n.getParent();
  return n?.getState?.() ?? null;
}

// navigation.navigate, but a tab destination keeps the trail back to where the person was.
export function navigateKeepingTrail(navigation, screen, params) {
  if (TAB_SCREENS.has(screen)) {
    const state = rootState(navigation);
    if (state && routesAboveTabs(state).length > 0) beginTrail(state, screen);
  }
  navigation.navigate(screen, params);
}

export function openDestination(navigation, destination, extraParams = null) {
  if (!destination || !navigation) return false;
  if (destination.kind === 'url') {
    if (!destination.url) return false;
    Linking.openURL(destination.url);
    return true;
  }
  if (destination.kind === 'navigate' && destination.screen) {
    const params = extraParams ? { ...(destination.params ?? {}), ...extraParams } : destination.params;
    navigateKeepingTrail(navigation, destination.screen, params);
    return true;
  }
  return false;
}
