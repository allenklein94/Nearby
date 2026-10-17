// Item 146 Option A (owner, 2026-10-17, LOCKED): a gathering's pin is keyed by its host + a ~780 m grid cell, so every
// gathering a host holds in one cell comes back from the server with the SAME pin. The map shows them as one stack: the
// gatherings sharing a pin sit on a tiny ring (STACK_RING_M) around that pin, each still its own marker with its own
// callout, so every one stays tappable on iOS and Android. The ring is drawn on the client from the pin alone (it never
// sees the meet-up point), in a fixed order, so it adds no location information; a stack is never spread by a server-side
// per-gathering offset (that is what let repeated pins average out). A single gathering stays exactly on its pin.
export const STACK_RING_M = 22;

const M_PER_DEG_LAT = 111320;

const pinned = (g) => g && g.id != null && g.latitude != null && g.longitude != null
  && Number.isFinite(Number(g.latitude)) && Number.isFinite(Number(g.longitude));

const byTimeThenId = (a, b) => {
  const ta = Date.parse(a.scheduled_at);
  const tb = Date.parse(b.scheduled_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
};

// [{ gathering, latitude, longitude, stackSize, stackIndex }] in the input's order; unpinned gatherings are left out.
export function stackGatheringPins(gatherings = []) {
  const list = (gatherings ?? []).filter(pinned);
  const stacks = new Map();
  for (const g of list) {
    const key = `${Number(g.latitude)},${Number(g.longitude)}`;
    if (!stacks.has(key)) stacks.set(key, []);
    stacks.get(key).push(g);
  }
  const placed = new Map();
  for (const members of stacks.values()) {
    const lat = Number(members[0].latitude);
    const lng = Number(members[0].longitude);
    if (members.length === 1) {
      placed.set(members[0], { latitude: lat, longitude: lng, stackSize: 1, stackIndex: 0 });
      continue;
    }
    const dLat = STACK_RING_M / M_PER_DEG_LAT;
    const dLng = STACK_RING_M / (M_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    [...members].sort(byTimeThenId).forEach((g, i) => {
      const angle = (2 * Math.PI * i) / members.length - Math.PI / 2;
      placed.set(g, {
        latitude: lat - dLat * Math.sin(angle),
        longitude: lng + dLng * Math.cos(angle),
        stackSize: members.length,
        stackIndex: i,
      });
    });
  }
  return list.map((g) => ({ gathering: g, ...placed.get(g) }));
}
