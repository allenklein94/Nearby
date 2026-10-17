import fs from 'fs';
import path from 'path';
import { stackGatheringPins, STACK_RING_M } from './mapPinStacks';
import { metersBetween } from './mapAreaActivity';

// Item 146 Option A (owner, 2026-10-17): gatherings sharing a host+cell pin show as one stack on the map.
const PIN = { latitude: 26.4013, longitude: -80.1234 };
const g = (id, at, pin = PIN, extra = {}) => ({ id, scheduled_at: at, ...pin, ...extra });

describe('stackGatheringPins', () => {
  test('a single gathering stays exactly on its pin', () => {
    expect(stackGatheringPins([g('a', '2026-10-20T19:00:00')])).toEqual([
      { gathering: expect.objectContaining({ id: 'a' }), ...PIN, stackSize: 1, stackIndex: 0 },
    ]);
  });

  test('gatherings sharing a pin sit on a small ring around it, each its own marker, none on top of another', () => {
    const list = [g('a', '2026-10-20T19:00:00'), g('b', '2026-10-27T19:00:00'), g('c', '2026-11-03T19:00:00')];
    const placed = stackGatheringPins(list);
    expect(placed.map((p) => p.gathering.id)).toEqual(['a', 'b', 'c']);
    for (const p of placed) {
      expect(p.stackSize).toBe(3);
      expect(metersBetween(PIN, p)).toBeCloseTo(STACK_RING_M, 0);
    }
    const keys = new Set(placed.map((p) => `${p.latitude},${p.longitude}`));
    expect(keys.size).toBe(3);
  });

  test('the ring order is fixed (time, then id), whatever order the list arrives in', () => {
    const list = [g('b', '2026-10-27T19:00:00'), g('c', '2026-10-20T19:00:00'), g('a', '2026-10-20T19:00:00')];
    const one = stackGatheringPins(list);
    const two = stackGatheringPins([...list].reverse());
    const at = (res, id) => res.find((p) => p.gathering.id === id);
    for (const id of ['a', 'b', 'c']) expect(at(two, id)).toEqual(at(one, id));
    expect(at(one, 'a').stackIndex).toBe(0);
    expect(at(one, 'c').stackIndex).toBe(1);
    expect(at(one, 'b').stackIndex).toBe(2);
  });

  test('different pins never stack; unpinned gatherings are left out', () => {
    const other = { latitude: 26.4089, longitude: -80.1234 };
    const placed = stackGatheringPins([g('a', 'x'), g('b', 'x', other), { id: 'c', latitude: null, longitude: null }]);
    expect(placed.map((p) => [p.gathering.id, p.stackSize, p.latitude])).toEqual([
      ['a', 1, PIN.latitude], ['b', 1, other.latitude],
    ]);
  });

  test('the ring is drawn from the pin alone: a stack never moves further than the ring from its pin', () => {
    const many = Array.from({ length: 52 }, (_, i) => g(`w${i}`, new Date(2026, 9, 20 + 7 * i).toISOString()));
    for (const p of stackGatheringPins(many)) expect(metersBetween(PIN, p)).toBeLessThan(STACK_RING_M + 0.5);
  });
});

describe('GatheringsMapView draws gathering markers only through stackGatheringPins', () => {
  const src = fs.readFileSync(path.join(__dirname, '../components/GatheringsMapView.js'), 'utf8');
  test('markers use the stacked coordinate, never the raw pin', () => {
    expect(src).toMatch(/stackGatheringPins\(/);
    expect(src).not.toMatch(/coordinate=\{\{\s*latitude:\s*g\.latitude/);
  });
});
