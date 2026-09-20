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
  const { weatherCardWithoutLead } = require('./homeAttention');
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
  it('the lead is never excluded, and is taken out of the weather rows instead', () => {
    const out = selectHomeAttention({ hero: { id: 'h' }, exclude: new Set(['h']), now });
    expect(out.hero.id).toBe('h');
    const card = { bias: 'indoor', gatherings: [{ id: 'h' }, { id: 'x' }] };
    expect(weatherCardWithoutLead(card, 'h').gatherings.map((g) => g.id)).toEqual(['x']);
    expect(weatherCardWithoutLead({ ...card, gatherings: [{ id: 'h' }] }, 'h')).toBeNull();
    expect(weatherCardWithoutLead(null, 'h')).toBeNull();
  });
  it('an object is never in both the list and the absorbed map', () => {
    const out = selectHomeAttention({ cards: [card('a', 30), card('b', 30)], exclude: new Set(['a']), now });
    const shown = out.items.map((i) => i.gathering.id);
    for (const id of out.absorbed.keys()) expect(shown).not.toContain(id);
  });
});
