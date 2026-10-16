import { isWithinRightNowWindow } from './rightNowWindow';

// Item 120 (owner, 2026-10-16, approved): "N happening now" on the Discover map. Static, public activity only.
// The ONE rule for which map areas get a label and what the label counts:
//   - counted: gatherings the viewer already sees as pins (the list the map is given: Discover's own visibility, block and
//     filter rules already applied) that are inside the canonical Happening Now window (isWithinRightNowWindow, the same
//     test buildDiscoverDateView('now') applies), so the label and the list it opens are the same set and the same count;
//   - an area: those gatherings whose pins are within MAP_AREA_LINK_M of another one in the area (single-link, zoom-independent);
//   - a label only for MAP_AREA_MIN or more (one gathering is already its own pin); none = no label, never a 0 or a guess.
// Never people, asks, Interested, perks, businesses or offers; never animated (no pulse, no glow).
export const MAP_AREA_LINK_M = 400;
export const MAP_AREA_MIN = 2;

const EARTH_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function metersBetween(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The map's own pin test (GatheringsMapView's pinnableGatherings), plus real numbers.
const pinned = (g) => g && g.id != null && g.latitude != null && g.longitude != null
  && Number.isFinite(Number(g.latitude)) && Number.isFinite(Number(g.longitude));

// [{ key, ids, count, latitude, longitude }] for each labelled area, largest first. `key` is stable for the same set.
export function happeningNowAreas(gatherings = [], now = new Date()) {
  const live = (gatherings ?? [])
    .filter((g) => pinned(g) && g.scheduled_at && isWithinRightNowWindow(g.scheduled_at, now))
    .map((g) => ({ id: g.id, latitude: Number(g.latitude), longitude: Number(g.longitude) }));
  const parent = live.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      if (metersBetween(live[i], live[j]) <= MAP_AREA_LINK_M) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  live.forEach((g, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(g);
  });
  return [...groups.values()]
    .filter((members) => members.length >= MAP_AREA_MIN)
    .map((members) => {
      const ids = members.map((m) => m.id).sort((a, b) => String(a).localeCompare(String(b)));
      return {
        key: ids.join('|'),
        ids,
        count: members.length,
        latitude: members.reduce((s, m) => s + m.latitude, 0) / members.length,
        longitude: members.reduce((s, m) => s + m.longitude, 0) / members.length,
      };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
