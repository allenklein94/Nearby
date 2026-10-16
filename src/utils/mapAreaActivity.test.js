import fs from 'fs';
import path from 'path';
import { happeningNowAreas, metersBetween, MAP_AREA_LINK_M, MAP_AREA_MIN } from './mapAreaActivity';
import { buildDiscoverDateView } from './discoverSections';
import { isMapLiveNow, isWithinRightNowWindow } from './rightNowWindow';

// Item 120 (owner, 2026-10-16): "N happening now" on the Discover map.
const NOW = new Date('2026-10-16T19:00:00');
const at = (min) => new Date(NOW.getTime() + min * 60000).toISOString();
// ~111 m per 0.001 deg latitude
const g = (id, startMin, dLat = 0, extra = {}) => ({ id, scheduled_at: at(startMin), latitude: 26.4 + dLat, longitude: -80.1, ...extra });

describe('happeningNowAreas', () => {
  test('two Happening Now gatherings within 400 m make one area; the label counts them', () => {
    const areas = happeningNowAreas([g('a', 10), g('b', 30, 0.002)], NOW);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ count: 2, ids: ['a', 'b'] });
    expect(areas[0].latitude).toBeCloseTo(26.401, 5);
  });

  test('one gathering is just its pin: no label; nothing qualifying = nothing', () => {
    expect(MAP_AREA_MIN).toBe(2);
    expect(happeningNowAreas([g('a', 10)], NOW)).toEqual([]);
    expect(happeningNowAreas([], NOW)).toEqual([]);
    expect(happeningNowAreas(undefined, NOW)).toEqual([]);
  });

  test('pins farther than 400 m apart are separate areas (no label for a lone one)', () => {
    expect(MAP_AREA_LINK_M).toBe(400);
    const far = happeningNowAreas([g('a', 10), g('b', 10, 0.005)], NOW); // ~555 m
    expect(far).toEqual([]);
  });

  test('single-link: a chain within 400 m step by step is one area', () => {
    const areas = happeningNowAreas([g('a', 0), g('b', 0, 0.003), g('c', 0, 0.006)], NOW);
    expect(areas.map((a) => a.count)).toEqual([3]);
  });

  test('only the canonical Happening Now window counts (started <= 30 min ago or starts within 2 h)', () => {
    const list = [g('in1', -29), g('in2', 119, 0.001), g('pastEdge', -31, 0.0005), g('futureEdge', 121, 0.0015)];
    const areas = happeningNowAreas(list, NOW);
    expect(areas).toHaveLength(1);
    expect(areas[0].ids).toEqual(['in1', 'in2']);
    for (const x of list) expect(areas[0].ids.includes(x.id)).toBe(isWithinRightNowWindow(x.scheduled_at, NOW));
  });

  test('a gathering without a pin (no coordinates) or without a time is never counted', () => {
    const areas = happeningNowAreas([g('a', 0), g('b', 0, 0.001), { id: 'c', scheduled_at: at(0), latitude: null, longitude: -80.1 }, { id: 'd', latitude: 26.4, longitude: -80.1 }], NOW);
    expect(areas[0].ids).toEqual(['a', 'b']);
  });

  test('the count follows the pins: a filter removing one drops the label', () => {
    const pins = [g('a', 0), g('b', 0, 0.001), g('c', 0, 0.0015)];
    expect(happeningNowAreas(pins, NOW)[0].count).toBe(3);
    expect(happeningNowAreas(pins.slice(0, 2), NOW)[0].count).toBe(2);
    expect(happeningNowAreas(pins.slice(0, 1), NOW)).toEqual([]);
  });

  test('the count follows the clock: once a gathering leaves the window it leaves the count', () => {
    const pins = [g('a', -20), g('b', 0, 0.001)];
    expect(happeningNowAreas(pins, NOW)[0].count).toBe(2);
    expect(happeningNowAreas(pins, new Date(NOW.getTime() + 15 * 60000))).toEqual([]);
  });

  test('metersBetween is roughly right', () => {
    expect(metersBetween({ latitude: 26.4, longitude: -80.1 }, { latitude: 26.401, longitude: -80.1 })).toBeCloseTo(111, 0);
  });
});

describe('the label and the list it opens are the same set and count', () => {
  test('Happening Now limited to an area lists exactly the area ids', () => {
    const list = [g('a', 5), g('b', 40, 0.001), g('c', 60, 0.02), g('d', 10, 0.0205), g('late', 300, 0.0005)];
    const areas = happeningNowAreas(list, NOW);
    expect(areas.map((a) => a.count)).toEqual([2, 2]);
    for (const area of areas) {
      const view = buildDiscoverDateView({ gatherings: list, dateFilter: 'now', now: NOW, areaIds: area.ids });
      expect(view.area).toBe(true);
      expect(view.items.map((x) => x.id).sort()).toEqual(area.ids);
      expect(view.items).toHaveLength(area.count);
    }
  });

  test('without an area the view is the whole of Happening Now; areaIds never narrow another date view', () => {
    const list = [g('a', 5), g('b', 40, 0.001), g('c', 60, 0.02)];
    expect(buildDiscoverDateView({ gatherings: list, dateFilter: 'now', now: NOW }).items).toHaveLength(3);
    expect(buildDiscoverDateView({ gatherings: list, dateFilter: 'now', now: NOW }).area).toBe(false);
    expect(buildDiscoverDateView({ gatherings: list, dateFilter: 'today', now: NOW, isInWindow: () => true, areaIds: ['a'] }).items).toHaveLength(3);
  });
});

describe('red "Live now" pins keep their own rule, now in rightNowWindow.js (owner: unchanged)', () => {
  test('starts within 30 min or started up to 2 h ago', () => {
    expect(isMapLiveNow(at(30), NOW)).toBe(true);
    expect(isMapLiveNow(at(31), NOW)).toBe(false);
    expect(isMapLiveNow(at(-120), NOW)).toBe(true);
    expect(isMapLiveNow(at(-121), NOW)).toBe(false);
    expect(isMapLiveNow(null, NOW)).toBe(false);
  });

  const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  test('the map holds no private time window and its area pill never animates', () => {
    const map = src('components/GatheringsMapView.js');
    expect(map).toMatch(/import \{ isMapLiveNow \} from '\.\.\/utils\/rightNowWindow'/);
    expect(map).not.toMatch(/function isHappeningNow/);
    expect(map).not.toMatch(/60 \* 1000/);
    expect(map).not.toMatch(/\bAnimated\b|Reanimated|LayoutAnimation/);
  });

  test('a red pin\'s screen-reader label says its own window, never "happening now" (owner, 2026-10-16)', () => {
    const ui = require('../i18n/ui/mapView').default;
    for (const strings of Object.values(ui)) expect(strings.gatheringLiveA11y).not.toBe(strings.gatheringA11y);
    expect(ui.en.gatheringLiveA11y).toBe('{title}, hosted by {name}, approximate location, starting soon or under way');
    expect(ui.en.gatheringLiveA11y).not.toMatch(/happening now/i);
    expect(ui.en.liveNow).toBe('🔴 LIVE NOW');
  });

  test('Discover shows areas only on the plain All view and computes them from the list the map pins', () => {
    const hub = src('screens/DiscoverHubScreen.js');
    expect(hub).toMatch(/const mapAreasShown = viewStyle === 'map' && isAll && !isSearching && !expandedContext && showGatherings;/);
    expect(hub).toMatch(/const mapAreas = mapAreasShown \? happeningNowAreas\(filteredGatherings\) : \[\];/);
    expect(hub).toMatch(/gatherings=\{showGatherings \? filteredGatherings : \[\]\}/);
    expect(hub).toMatch(/buildDiscoverDateView\(\{ gatherings: filteredGatherings, dateFilter: dateView, score: scoreGathering, areaIds: dateViewArea \}\)/);
  });
});
