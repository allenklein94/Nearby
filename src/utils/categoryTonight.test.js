import { splitTonight, isTonightGathering } from './categoryTonight';

const now = new Date(2026, 8, 21, 14, 0, 0); // Mon 2 PM local
const at = (dayOffset, hour) => new Date(2026, 8, 21 + dayOffset, hour, 0, 0).toISOString();
const g = (id, when) => ({ id, scheduled_at: when });

describe('Happening tonight slice', () => {
  const tonightA = g('a', at(0, 19));
  const afternoon = g('b', at(0, 17)); // TODAY (before 6 PM), not tonight
  const nextWeek = g('c', at(6, 19));
  it('uses the same time badge: an evening today is tonight, an afternoon and a later day are not', () => {
    expect(isTonightGathering(tonightA, now)).toBe(true);
    expect(isTonightGathering(afternoon, now)).toBe(false);
    expect(isTonightGathering(nextWeek, now)).toBe(false);
    expect(isTonightGathering(g('r', at(0, 15)), now)).toBe(false); // RIGHT NOW (within 2 h) keeps its own badge
    expect(isTonightGathering(g('x', null), now)).toBe(false);
  });
  it('category with tonight activity: tonight items move out of the main list (no duplicate)', () => {
    const r = splitTonight([tonightA, afternoon, nextWeek], [], null, now);
    expect(r.tonight.map((x) => x.id)).toEqual(['a']);
    expect(r.main.map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('category with no tonight activity: slice empty, lists untouched', () => {
    const r = splitTonight([afternoon, nextWeek], [], null, now);
    expect(r.tonight).toEqual([]);
    expect(r.main).toHaveLength(2);
  });
  it('a gathering eligible for both lists appears once; the other-time list is deduped too', () => {
    const r = splitTonight([tonightA, afternoon], [tonightA, g('d', at(0, 20)), nextWeek], 'TODAY', now);
    expect(r.tonight.map((x) => x.id)).toEqual(['a', 'd']);
    expect(r.main.map((x) => x.id)).toEqual(['b']);
    expect(r.other.map((x) => x.id)).toEqual(['c']);
    const shown = [...r.tonight, ...r.main, ...r.other].map((x) => x.id);
    expect(new Set(shown).size).toBe(shown.length);
  });
  it('the existing Tonight context is left exactly as it is (no slice)', () => {
    const r = splitTonight([tonightA], [g('e', at(0, 21))], 'TONIGHT', now);
    expect(r.tonight).toEqual([]);
    expect(r.main).toHaveLength(1);
    expect(r.other).toHaveLength(1);
    expect(splitTonight([tonightA], [], 'RIGHT NOW', now).tonight).toEqual([]);
  });
  it('multiple categories: each view splits only its own rows', () => {
    const coffee = splitTonight([tonightA], [], null, now);
    const music = splitTonight([g('m', at(1, 20))], [], null, now);
    expect(coffee.tonight).toHaveLength(1);
    expect(music.tonight).toHaveLength(0);
  });
  it('bad input is safe', () => {
    expect(splitTonight(undefined, null, null, now)).toEqual({ tonight: [], main: [], other: [] });
  });
});

describe('wiring', () => {
  const src = require('fs').readFileSync(require.resolve('../screens/DiscoverHubScreen.js'), 'utf8');
  it('is one inline slice over the lists the view already has: no new query, screen or navigation', () => {
    expect(src).toContain("import { splitTonight } from '../utils/categoryTonight'");
    expect((src.match(/>Happening tonight</g) ?? []).length).toBe(1);
    const block = src.slice(src.indexOf('const { tonight: contextTonight'), src.indexOf('const { tonight: contextTonight') + 400);
    expect(block).not.toMatch(/getNearbyGatherings|supabase|navigate/);
  });
});
