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
//   'setParams' -> the screen already on top IS this object (same surface, same ids; a presentation route such as
//                  'Notices' counts as the surface it presents, so a wave tap while on the Activity tab refreshes it):
//                  refresh it in place (e.g. a second offer on the same request
//                  re-focuses it) instead of stacking a duplicate
//   'push'      -> everything else: a new screen on top of the current history
import { canonicalRoute } from './presentationRoutes';

export const NAVIGATE_DESTINATIONS = new Set(['MainTabs']);

// Params that identify WHICH object a screen shows. Everything else
// (notificationReason, focusOfferId, initialSection, openJoin...) is context
// for that visit and may change without making it a different object.
// One level of nesting counts too (AskBusiness carries its posting as matchedAvailability.availabilityId), so two different
// postings are two different screens, never one overwriting the other's form.
export function identityOf(params) {
  const out = {};
  const p = params ?? {};
  for (const k of Object.keys(p)) {
    if (/Id$/.test(k) && k !== 'focusOfferId') out[k] = p[k] == null ? null : String(p[k]);
    else if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) {
      for (const kk of Object.keys(p[k])) if (/Id$/.test(kk)) out[`${k}.${kk}`] = p[k][kk] == null ? null : String(p[k][kk]);
    }
  }
  return JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1))));
}

export function notificationNavAction(currentRoute, name, params) {
  if (NAVIGATE_DESTINATIONS.has(name)) return 'navigate';
  if (currentRoute && canonicalRoute(currentRoute.name) === canonicalRoute(name) && identityOf(currentRoute.params) === identityOf(params)) {
    return 'setParams';
  }
  return 'push';
}
