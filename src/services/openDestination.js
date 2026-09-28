// Opening a recommendation (shared context layer, 2026-09-28): the ONE place a context object's `destination` is followed.
// { kind: 'navigate', screen, params } -> navigation; { kind: 'url', url } -> the OS (maps for Go now / Directions). A missing or
// malformed destination does nothing and returns false, so a card with no real destination is never a wrong screen.
import { Linking } from 'react-native';

export function openDestination(navigation, destination, extraParams = null) {
  if (!destination || !navigation) return false;
  if (destination.kind === 'url') {
    if (!destination.url) return false;
    Linking.openURL(destination.url);
    return true;
  }
  if (destination.kind === 'navigate' && destination.screen) {
    const params = extraParams ? { ...(destination.params ?? {}), ...extraParams } : destination.params;
    navigation.navigate(destination.screen, params);
    return true;
  }
  return false;
}
