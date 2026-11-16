// Multi-location Business Mode (owner, 2026-11-16; migration 20270424, STAGED). ONE rule for when the location selector
// shows and what a push needs before it opens. Pure; the server (select_managed_business) is the only authority on which
// location an account may act for: nothing here decides permission.

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

// A business push names its location (partner_id). Switch first only when it is another membership; never for an id the
// account isn't a member of (the server would refuse anyway) and never when the push carries none (older pushes).
export function locationToSelectForPush(data, locations) {
  const target = typeof data?.partner_id === 'string' ? data.partner_id : null;
  if (!target) return null;
  const list = normalizeBusinessLocations(locations);
  const row = list.find((r) => r.partner_id === target);
  if (!row || row.is_selected) return null;
  return target;
}
