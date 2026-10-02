import { CommonActions } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getTrail, clearTrail, restorableRoutes, TAB_HOST } from './returnTrail';

// Item 139 follow-up: reopening the trail (see returnTrail.js for the rules).

// Object screens whose subject can disappear or stop being visible. Checked
// with the person's CURRENT permissions (RLS): no row = skip that screen.
// A failed lookup keeps the screen (a network blip never erases history; the
// screen shows its own error). Anything not listed opens as before.
const OBJECT_CHECKS = {
  gatheringId: 'gatherings',
  requestId: 'business_requests',
  matchId: 'matches',
  userId: 'profiles',
  communityId: 'communities',
  planId: 'plans',
  partnerId: 'brand_partners',
};

async function stillOpenable(route, routeNames) {
  if (!routeNames.includes(route.name)) return false; // e.g. signed out since
  const params = route.params ?? {};
  const key = Object.keys(OBJECT_CHECKS).find((k) => params[k] != null);
  if (!key) return true;
  try {
    const { data, error } = await supabase.from(OBJECT_CHECKS[key]).select('id').eq('id', params[key]).maybeSingle();
    if (error) return true;
    return !!data;
  } catch (e) {
    return true;
  }
}

export async function restoreTrail(ref) {
  const t = getTrail();
  clearTrail();
  if (!t || !ref.isReady()) return false;
  const root = ref.getRootState();
  const host = root?.routes?.find((r) => r.name === TAB_HOST);
  if (!host) return false;
  const routeNames = root.routeNames ?? [];
  const checks = await Promise.all(t.routes.map((r) => stillOpenable(r, routeNames)));
  const reopen = restorableRoutes(t.routes, checks);
  if (reopen.length === 0) return false;
  ref.dispatch(CommonActions.reset({
    index: reopen.length,
    // The existing tab host route is kept as is (same key and tab state), so
    // Home/Discover stay mounted with their state; only the closed screens come back.
    routes: [host, ...reopen.map((r) => ({ name: r.name, params: r.params }))],
  }));
  return true;
}
