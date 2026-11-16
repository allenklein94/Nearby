// Multi-location Business Mode (owner, 2026-11-16; migration 20270424, STAGED). ONE rule for when the location selector
// shows and what a push needs before it opens. Pure; the server (select_managed_business) is the only authority on which
// location an account may act for: nothing here decides permission.

import { isOwnerGroup, notificationGroupOf } from '../constants/notificationPreferences';

// rows = get_my_businesses() rows ({ partner_id, name, address, role, is_selected }); missing / failed read = [].
export function normalizeBusinessLocations(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  return rows.filter((r) => r && typeof r.partner_id === 'string' && !seen.has(r.partner_id) && seen.add(r.partner_id));
}

// One location (every business today) = no selector, no extra tap.
export function showLocationSelector(locations) {
  return normalizeBusinessLocations(locations).length > 1;
}

export function currentLocation(locations) {
  return normalizeBusinessLocations(locations).find((r) => r.is_selected) ?? null;
}


// The selection is per ACCOUNT (one column, 20270424): another device or the website may switch it while this screen still
// shows the old location, and every profile / hours / availability write then lands on the location the server has
// selected. On focus and on return to the foreground Business Mode compares the server's selection with the one it shows:
// a change made elsewhere returns the newly selected id (null = no location selected any more) so the caller reloads
// Business Mode for it; unchanged, unknown (nothing seen yet) or an empty / failed read (single location, 0424 not live)
// returns undefined = keep as is.
export function selectionChangedElsewhere(shownId, locations) {
  const list = normalizeBusinessLocations(locations);
  if (!list.length || shownId === undefined) return undefined;
  const now = currentLocation(list)?.partner_id ?? null;
  return now === shownId ? undefined : now;
}

// A push or an alert email names ONE location (partner_id). Before its request opens: already that location, or no
// location named, or nothing to compare against (single location / 0424 not live / failed read) = open as today. Another of
// the account's locations = switch first (server-checked). Named but not switched to (not a member, refused, failed) =
// never open that request under the location currently selected: the caller falls back to plain Opportunities.
// Only the owner's own business alerts (the owner_* notification groups) follow this rule; any other push that names a
// business (a perk, a business profile) is about that business as a place, never about acting for it: opened as today.
export function locationPlanForLink(data, locations) {
  const target = typeof data?.partner_id === 'string' && isOwnerGroup(notificationGroupOf(data?.type)) ? data.partner_id : null;
  const list = normalizeBusinessLocations(locations);
  if (!target || !list.length) return { action: 'open' };
  const row = list.find((r) => r.partner_id === target);
  if (row?.is_selected) return { action: 'open' };
  return row ? { action: 'switch', partnerId: target } : { action: 'fallback' };
}

// Where a push / link goes when its named location can't be opened: plain Opportunities (no request focus).
export const LOCATION_FALLBACK_DESTINATION = Object.freeze({ name: 'BusinessDashboard', params: Object.freeze({ initialSection: 'requests' }) });
