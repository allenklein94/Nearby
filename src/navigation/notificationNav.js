// Item 139: a push tap opens its object ON TOP of whatever the person was
// doing, so Back returns there (not Home, and not an older copy of the same
// screen). React Navigation 6's `navigate` jumps BACK to an existing route of
// the same name and replaces its params, which dropped every screen above it
// (e.g. reading GatheringDetail A -> a friend's profile -> Chat, then a push
// for gathering B popped Chat and the profile and turned A into B).
//
// Pure decision, no React Native imports, so it is unit-tested:
//   'navigate'  -> tab/root destinations (MainTabs); switching tabs is navigation,
//                  not a new screen on top
//   'setParams' -> the screen already on top IS this object (same name, same ids):
//                  refresh it in place (e.g. a second offer on the same request
//                  re-focuses it) instead of stacking a duplicate
//   'push'      -> everything else: a new screen on top of the current history
export const NAVIGATE_DESTINATIONS = new Set(['MainTabs']);

// Params that identify WHICH object a screen shows. Everything else
// (notificationReason, focusOfferId, initialSection, openJoin...) is context
// for that visit and may change without making it a different object.
export function identityOf(params) {
  const out = {};
  Object.keys(params ?? {})
    .filter((k) => /Id$/.test(k) && k !== 'focusOfferId')
    .sort()
    .forEach((k) => { out[k] = params[k] == null ? null : String(params[k]); });
  return JSON.stringify(out);
}

export function notificationNavAction(currentRoute, name, params) {
  if (NAVIGATE_DESTINATIONS.has(name)) return 'navigate';
  if (currentRoute && currentRoute.name === name && identityOf(currentRoute.params) === identityOf(params)) {
    return 'setParams';
  }
  return 'push';
}
