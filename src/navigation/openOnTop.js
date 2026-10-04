import { StackActions, CommonActions, getActionFromState as defaultGetActionFromState } from '@react-navigation/native';
import { notificationNavAction } from './notificationNav';
import { beginTrail, TAB_HOST } from './returnTrail';
import { isRegistered } from './outsideEntry';
import { isPresentation } from './presentationRoutes';

// Item 139: the one way an outside entry (push tap, nearby:// link) opens an
// object: on top of the current history, refreshed in place when it is already
// the top screen, tab switches as navigation. Decision lives in notificationNav.js.
// Returns whether it opened. A destination the current stack does not register (signed out, onboarding) is never
// dispatched: callers keep the entry and open it once signed in (outsideEntry.js).
export function openOnTop(ref, name, params) {
  if (!ref.isReady()) return false;
  if (!isRegistered(ref, name)) return false;
  const current = ref.getCurrentRoute();
  const action = notificationNavAction(current, name, params);
  if (action === 'setParams') {
    // A presentation refreshed in place (a wave tap while Activity is showing) gets a fresh openedAt so the screen reloads;
    // focus effects do not fire when the screen is already focused.
    const next = isPresentation(name) ? { ...(params ?? {}), openedAt: Date.now() } : (params ?? {});
    ref.dispatch({ ...CommonActions.setParams(next), source: current.key });
  } else if (action === 'push') {
    ref.dispatch(StackActions.push(name, params));
  } else {
    // A tab destination closes the screens above the tabs; remember them (returnTrail.js).
    if (name === TAB_HOST) beginTrail(ref.getRootState(), params?.screen ?? null);
    ref.navigate(name, params);
  }
  return true;
}

// For NavigationContainer `linking.getActionFromState`: a warm nearby:// link to a
// single screen gets the same treatment instead of React Navigation's default
// navigate (which jumps back to an older copy of that screen).
export function linkActionFromState(ref) {
  return (state, options) => {
    const routes = state?.routes ?? [];
    // A link resolves to [destination], or [tab host, destination] since the linking config puts Home under a cold-start
    // link; either way the destination is the leaf.
    const leaf = routes.length === 1 ? routes[0]
      : routes.length === 2 && routes[0].name === TAB_HOST && !routes[0].state ? routes[1] : null;
    if (leaf && !leaf.state && ref.isReady()) {
      const current = ref.getCurrentRoute();
      const action = notificationNavAction(current, leaf.name, leaf.params);
      if (action === 'push') return StackActions.push(leaf.name, leaf.params);
      if (action === 'setParams') return { ...CommonActions.setParams(leaf.params ?? {}), source: current.key };
    }
    return defaultGetActionFromState(state, options);
  };
}
