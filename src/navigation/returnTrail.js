// Item 139 follow-up (owner, 2026-10-02): the return trail.
//
// Nearby's tabs sit at the bottom of ONE root stack; every other screen (Chat,
// a gathering, a profile...) opens over the whole tab area. So a push whose
// destination IS a tab (a recall occasion or a friends' signal -> Home, an
// availability push -> Discover) has to close the screens above the tabs to
// show it. This remembers what it closed so Back (Android) or the
// "← Back to ..." chip (iOS) can reopen it, in order.
//
// Rules (owner, LOCKED):
//  - at most TRAIL_LIMIT screens, the ones nearest where the person was
//  - only a tab destination that actually closed screens starts a trail
//  - restoring reopens the screens in their original order on top of the tabs
//    (they reload their data; scroll position and unsaved text are not kept;
//    saved form drafts are, item 82)
//  - a screen that can no longer be opened (route gone after sign-out, object
//    deleted or no longer visible) is skipped; Back then lands on the nearest
//    one that still opens, or simply stays on the tab
//  - the trail ends when the person goes anywhere else (opens a screen,
//    switches tab), signs out, or uses it; it never blocks the tab bar or any
//    normal navigation (it only answers Back on that one tab)
//
// Pure: no React Native imports (store + decisions), unit-tested.

export const TRAIL_LIMIT = 10;
export const TAB_HOST = 'MainTabs';

let trail = null; // { tab, routes: [{ name, params }] }
const listeners = new Set();

function emit() { listeners.forEach((fn) => fn(trail)); }

export function getTrail() { return trail; }
export function subscribeTrail(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function clearTrail() { if (trail) { trail = null; emit(); } }

// Routes above the tab host in the root stack state, oldest first, capped to
// the newest TRAIL_LIMIT (the ones nearest where the person was).
export function routesAboveTabs(rootState) {
  const routes = rootState?.routes ?? [];
  const hostIndex = routes.findIndex((r) => r.name === TAB_HOST);
  if (hostIndex < 0) return [];
  return routes
    .slice(hostIndex + 1, (rootState.index ?? routes.length - 1) + 1)
    .map((r) => ({ name: r.name, params: r.params ?? undefined }))
    .slice(-TRAIL_LIMIT);
}

export function activeTab(rootState) {
  const host = (rootState?.routes ?? []).find((r) => r.name === TAB_HOST);
  const tabState = host?.state;
  if (!tabState) return host?.params?.screen ?? null;
  return tabState.routes?.[tabState.index ?? 0]?.name ?? null;
}

// Called right before a push switches to a tab. Screens it is about to close
// become the trail; with nothing to close, an existing trail moves with the
// person to the new tab (their last place is unchanged) instead of being lost.
export function beginTrail(rootState, tab) {
  const closing = routesAboveTabs(rootState);
  // `pending` until the tab switch lands: a nested navigate can reach the tabs in
  // a second state update, and the in-between state (old tab) is not the person
  // switching away.
  if (closing.length > 0) trail = { tab, routes: closing, pending: true };
  else if (trail) trail = { ...trail, tab, pending: true };
  else return;
  emit();
}

// Every navigation change: the trail survives only while the person stays on
// that tab with nothing opened over it.
export function noteNavigationState(rootState) {
  if (!trail) return;
  const openedSomething = routesAboveTabs(rootState).length > 0;
  const tab = activeTab(rootState);
  if (openedSomething) { clearTrail(); return; }
  if (trail.pending) {
    if (tab === trail.tab) trail = { ...trail, pending: false };
    return;
  }
  if (tab && tab !== trail.tab) clearTrail();
}

// The routes to reopen, given which of them can still be opened.
export function restorableRoutes(routes, canOpen) {
  return (routes ?? []).filter((r, i) => canOpen[i] !== false);
}

// Key under ui.returnTrail (11 languages, scripts/i18n/strings/returnTrail.json),
// named by the screen the person was last on ("Back to Chat").
const LABEL_KEYS = {
  Chat: 'chat',
  GroupChat: 'groupChat',
  GatheringDetail: 'gathering',
  ViewProfile: 'profile',
  BusinessProfile: 'business',
  BusinessRequestDetail: 'request',
  PlanDetail: 'plan',
  GroupPlan: 'groupPlan',
  CommunityDetail: 'community',
  Matches: 'matches',
  EditProfile: 'myProfile',
  Settings: 'settings',
  Notices: 'notices',
};

export function trailLabelKey(t) {
  const last = t?.routes?.[t.routes.length - 1];
  if (!last) return null;
  return `ui.returnTrail.${LABEL_KEYS[last.name] ?? 'fallback'}`;
}
