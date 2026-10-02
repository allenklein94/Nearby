import { StackActions, CommonActions, getActionFromState as defaultGetActionFromState } from '@react-navigation/native';
import { notificationNavAction } from './notificationNav';

// Item 139: the one way an outside entry (push tap, nearby:// link) opens an
// object: on top of the current history, refreshed in place when it is already
// the top screen, tab switches as navigation. Decision lives in notificationNav.js.
export function openOnTop(ref, name, params) {
  if (!ref.isReady()) return;
  const current = ref.getCurrentRoute();
  const action = notificationNavAction(current, name, params);
  if (action === 'setParams') {
    ref.dispatch({ ...CommonActions.setParams(params ?? {}), source: current.key });
  } else if (action === 'push') {
    ref.dispatch(StackActions.push(name, params));
  } else {
    ref.navigate(name, params);
  }
}

// For NavigationContainer `linking.getActionFromState`: a warm nearby:// link to a
// single screen gets the same treatment instead of React Navigation's default
// navigate (which jumps back to an older copy of that screen).
export function linkActionFromState(ref) {
  return (state, options) => {
    const routes = state?.routes ?? [];
    const leaf = routes.length === 1 ? routes[0] : null;
    if (leaf && !leaf.state && ref.isReady()) {
      const current = ref.getCurrentRoute();
      const action = notificationNavAction(current, leaf.name, leaf.params);
      if (action === 'push') return StackActions.push(leaf.name, leaf.params);
      if (action === 'setParams') return { ...CommonActions.setParams(leaf.params ?? {}), source: current.key };
    }
    return defaultGetActionFromState(state, options);
  };
}
