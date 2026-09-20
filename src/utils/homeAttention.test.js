const { selectHomeAttention, MAX_HOME_ATTENTION } = require('./homeAttention');

const now = new Date(2026, 8, 20, 15, 0);
const at = (mins) => new Date(now.getTime() + mins * 60000).toISOString();
const card = (id, mins, signals = [{ kind: 'interest', text: 'Because you like Coffee' }], extra = {}) => ({
  gathering: { id, title: id, scheduled_at: at(mins) }, signals, reasons: signals.map((s) => s.text), hasFriend: false, trendingOnly: false, ...extra,
});
const rec = (id, mins) => ({ type: 'gathering', id, title: id, reasons: ['Because you like Coffee'], data: { id, title: id, scheduled_at: at(mins) } });

describe('selectHomeAttention', () => {
  it('never shows more than the cap, lead included', () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(`c${i}`, 600 + i));
    const out = selectHomeAttention({ hero: { id: 'h' }, cards, recommended: [rec('r1', 700)], now });
    expect(out.items).toHaveLength(MAX_HOME_ATTENTION - 1);
    expect(out.shown).toBe(MAX_HOME_ATTENTION);
    expect(out.total).toBeGreaterThan(out.shown);
  });
  it('without a lead the cap applies to the list itself', () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(`c${i}`, 600));
    expect(selectHomeAttention({ cards, now }).items).toHaveLength(MAX_HOME_ATTENTION);
  });
  it('time-sensitive and friend-backed things outrank evergreen ones', () => {
    const cards = [card('later', 900), card('soon', 45), card('friend', 900, [{ kind: 'interest', text: 'x' }, { kind: 'going', text: 'Sam is going' }])];
    const ids = selectHomeAttention({ cards, now }).items.map((i) => i.gathering.id);
    expect(ids.indexOf('soon')).toBeLessThan(ids.indexOf('later'));
    expect(ids.indexOf('friend')).toBeLessThan(ids.indexOf('later'));
  });
  it('one object appears once across engines, keeping the merged card', () => {
    const out = selectHomeAttention({ hero: { id: 'h' }, cards: [card('a', 300)], recommended: [rec('a', 300), rec('h', 300), rec('b', 300)], soon: [{ id: 'a' }, { id: 'b' }, { id: 'c', scheduled_at: at(20) }], now });
    const ids = out.items.map((i) => i.gathering?.id ?? `perk-${i.item.id}`);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });
  it('a ranked-list gathering carries only its real reason; starting soon says so', () => {
    const out = selectHomeAttention({ recommended: [rec('r', 900)], soon: [{ id: 's', scheduled_at: at(20) }], now });
    expect(out.items.find((i) => i.gathering.id === 's').reasons).toEqual(['Starting soon']);
    expect(out.items.find((i) => i.gathering.id === 'r').reasons).toEqual(['Because you like Coffee']);
  });
  it('perks are kept as their own kind and rank behind time-sensitive gatherings', () => {
    const out = selectHomeAttention({ cards: [card('soon', 30)], recommended: [{ type: 'perk', id: 'p', title: 'Free coffee', reasons: [], data: {} }], now });
    expect(out.items.map((i) => i.kind)).toEqual(['gathering', 'perk']);
  });
  it('nothing in, nothing shown (no invented content)', () => {
    expect(selectHomeAttention({ now })).toMatchObject({ items: [], shown: 0, total: 0 });
  });
});

describe('global dedupe (already rendered above)', () => {
  it('an object already above is not rendered again; its reasons are handed to the earlier surface', () => {
    const out = selectHomeAttention({
      hero: { id: 'h' },
      cards: [card('a', 300, [{ kind: 'interest', text: 'Because you like Coffee' }, { kind: 'trending', text: 'Trending nearby' }]), card('b', 300)],
      exclude: new Set(['a']),
      now,
    });
    expect(out.items.map((i) => i.gathering.id)).toEqual(['b']);
    expect(out.absorbed.get('a')).toEqual(['Because you like Coffee', 'Trending nearby']);
  });
  it('covers every engine: ranked list and starting soon too, and slots refill', () => {
    const out = selectHomeAttention({ recommended: [rec('r', 900), rec('r2', 900)], soon: [{ id: 's', scheduled_at: at(20) }], exclude: new Set(['r', 's']), now });
    expect(out.items.map((i) => i.gathering.id)).toEqual(['r2']);
    expect(out.absorbed.get('r')).toEqual(['Because you like Coffee']);
    expect(out.absorbed.get('s')).toEqual(['Starting soon']);
  });
  it('the Best Pick lead is NOT exempt: already above = dropped, its reasons absorbed, the slot refilled', () => {
    const out = selectHomeAttention({
      hero: { id: 'h', reasons: ['Because you like Coffee'] },
      cards: [card('a', 300), card('b', 300), card('c', 300), card('d', 300), card('e', 300)],
      exclude: new Set(['h']),
      now,
    });
    expect(out.hero).toBeNull();
    expect(out.absorbed.get('h')).toEqual(['Because you like Coffee']);
    expect(out.items).toHaveLength(MAX_HOME_ATTENTION); // the lead's slot goes to the next candidate
    expect(out.shown).toBe(MAX_HOME_ATTENTION);
  });
  it('cardWithoutIds removes rows shown higher up and hides an emptied card', () => {
    const { cardWithoutIds } = require('./homeAttention');
    const c = { bias: 'indoor', gatherings: [{ id: 'p' }, { id: 'x' }] };
    expect(cardWithoutIds(c, new Set(['p'])).gatherings.map((g) => g.id)).toEqual(['x']);
    expect(cardWithoutIds({ ...c, gatherings: [{ id: 'p' }] }, new Set(['p']))).toBeNull();
    expect(cardWithoutIds(null, new Set())).toBeNull();
  });
  it('an object is never in both the list and the absorbed map', () => {
    const out = selectHomeAttention({ cards: [card('a', 30), card('b', 30)], exclude: new Set(['a']), now });
    const shown = out.items.map((i) => i.gathering.id);
    for (const id of out.absorbed.keys()) expect(shown).not.toContain(id);
  });
});

describe('Best Pick can never cause a duplicate on Home', () => {
  const { cardWithoutIds, HOME_SECTION_PRIORITY } = require('./homeAttention');
  const fs = require('fs');
  const path = require('path');

  // Emulates Home's placement order for every way the SAME gathering can be surfaced, and asserts it renders exactly once.
  function placements({ heroIn, planIds = [], weatherIds = [], firstRunIds = [] }) {
    const g = (id) => ({ id });
    const above = new Set([...firstRunIds, ...planIds]);
    const weather = cardWithoutIds({ gatherings: weatherIds.map(g) }, above);
    const weatherSet = new Set(weather ? weather.gatherings.map((x) => x.id) : []);
    const out = selectHomeAttention({
      hero: { id: heroIn, reasons: [] },
      cards: [card('other1', 300), card('other2', 300)],
      recommended: [rec(heroIn, 300), rec('other3', 300)],
      soon: [{ id: heroIn, scheduled_at: at(10) }],
      exclude: new Set([...above, ...weatherSet]),
      now,
    });
    return [
      ...firstRunIds, ...planIds, ...weatherSet,
      ...(out.hero ? [out.hero.id] : []),
      ...out.items.map((i) => i.gathering?.id ?? `perk-${i.item.id}`),
    ];
  }
  const cases = {
    'Best Pick also in Your Interest / Plans': { heroIn: 'X', planIds: ['X'] },
    'Best Pick also in the weather card': { heroIn: 'X', weatherIds: ['X', 'W'] },
    'Best Pick also in the first-run card': { heroIn: 'X', firstRunIds: ['X'] },
    'weather row also in Your Plans': { heroIn: 'H', planIds: ['W'], weatherIds: ['W'] },
    'nothing duplicated at all': { heroIn: 'X' },
  };
  for (const [name, input] of Object.entries(cases)) {
    it(`renders each gathering once: ${name}`, () => {
      const ids = placements(input);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
  it('the Best Pick is kept in its higher placement, not dropped everywhere', () => {
    expect(placements({ heroIn: 'X', planIds: ['X'] })).toContain('X');
    expect(placements({ heroIn: 'X', weatherIds: ['X'] })).toContain('X');
  });
  it('priority order is explicit and Best Pick sits below plans and weather', () => {
    expect(HOME_SECTION_PRIORITY).toEqual(['firstRun', 'yourPlans', 'weather', 'bestPick', 'pickedForYou']);
  });
  it('Home source has no lead exemption and renders the hero from the deduped selection', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', 'screens', 'HomeScreen.js'), 'utf8');
    expect(home).not.toMatch(/weatherCardWithoutLead/);
    expect(home).not.toMatch(/homeMerge\.hero\.(title|reasons|id)\b/);
    expect(home).toMatch(/attention\.hero && \(/);
    const lib = fs.readFileSync(path.join(__dirname, 'homeAttention.js'), 'utf8');
    expect(lib).not.toMatch(/id !== hero\?\.id/);
  });
  it('Interested stays private: no friend-visible interested signal anywhere in the attention layer', () => {
    const lib = fs.readFileSync(path.join(__dirname, 'homeAttention.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(lib).not.toMatch(/gathering_interested|interestedIds|is interested/);
  });
});
