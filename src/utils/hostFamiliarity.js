// Host familiarity (owner, 2026-11-11; migration 20270410): a gathering hosted by someone the person has really been at
// gatherings with ranks ahead of one that is otherwise EQUAL. Personalization only: never trust, limits, moderation, access,
// visibility or eligibility, and never shown (no reason line, no badge, no count, never makes a pick "personal").
//
// ONE source: get_my_familiar_hosts (services/familiarHosts.js) = per person, the ENDED gatherings in the last 365 days the
// viewer shared with them (attendee or host on either side), capped at FAMILIARITY_CAP by the server and again here.
// ONE rule: compareFamiliarity, used only as a tie-breaker AFTER each surface's own full ranking compares equal:
//   Home Picked For You (utils/homeAttention.js), Home candidate pool (services/homeRecommendations.js), Best Pick
//   (services/gatherings.js pickBestGathering), Discover gathering lists (utils/discoverSections.js compareDiscover, inside the
//   same one-mile distance band only, so it never puts a far gathering ahead of a near one), typed asks
//   (services/intentResolver.js, after the existing personal tie-break).
// It therefore never outranks the ask, a stated constraint, friends, time, interests, weather, popularity or distance.
// Missing / failed read = an empty map = every order exactly as before.

export const FAMILIARITY_CAP = 3;
export const EMPTY_FAMILIAR_HOSTS = Object.freeze(new Map());

// RPC rows [{ person_id, shared_count }] -> Map(personId -> 1..FAMILIARITY_CAP). Anything malformed is left out.
export function familiarHostsFromRows(rows) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = typeof r?.person_id === 'string' ? r.person_id : null;
    const n = Math.floor(Number(r?.shared_count));
    if (!id || !Number.isFinite(n) || n <= 0) continue;
    map.set(id, Math.min(n, FAMILIARITY_CAP));
  }
  return map;
}

// 0..FAMILIARITY_CAP for one host. The viewer's own gathering is never "familiar" (the server never returns the viewer).
export function familiarityOf(hostId, familiarHosts) {
  if (!hostId || !(familiarHosts instanceof Map)) return 0;
  const n = familiarHosts.get(hostId);
  return Number.isFinite(n) && n > 0 ? Math.min(n, FAMILIARITY_CAP) : 0;
}

// < 0 when `a` ranks ahead. `hostOf` reads the host id from a surface's own item shape.
export function compareFamiliarity(a, b, familiarHosts, hostOf = (x) => x?.host_id ?? null) {
  if (!(familiarHosts instanceof Map) || familiarHosts.size === 0) return 0;
  return familiarityOf(hostOf(b), familiarHosts) - familiarityOf(hostOf(a), familiarHosts);
}

// Discover's distance band: gatherings within the same whole mile compete on familiarity before nearest; a different band is
// decided by distance exactly as before. Unknown distance = its own last band.
export function distanceBand(distanceMiles) {
  return Number.isFinite(distanceMiles) && distanceMiles >= 0 ? Math.floor(distanceMiles) : Infinity;
}
