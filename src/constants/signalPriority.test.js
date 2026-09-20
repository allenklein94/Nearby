const { SIGNAL_TIERS, reasonTier, signalTier, bestTier } = require('./signalPriority');
const { selectHomeAttention } = require('../utils/homeAttention');

const now = new Date(2026, 8, 20, 15, 0);
const at = (mins) => new Date(now.getTime() + mins * 60000).toISOString();
const sig = (kind, text = kind) => ({ kind, text });
const card = (id, signals, extra = {}, mins = 900) => ({
  gathering: { id, title: id, interest_tag: 'Coffee', scheduled_at: at(mins), ...extra }, signals, reasons: signals.map((s) => s.text), hasFriend: false, trendingOnly: false,
});
const order = (cards, extra = {}) => selectHomeAttention({ cards, now, ...extra }).items.map((i) => i.gathering?.id ?? `perk-${i.item.id}`);

describe('tier table', () => {
  it('is the owner ranking, strongest first', () => {
    expect(Object.entries(SIGNAL_TIERS).sort((a, b) => a[1] - b[1]).map(([k]) => k)).toEqual(
      ['intent', 'planFriend', 'time', 'interest', 'business', 'popularity', 'weather', 'discovery'],
    );
  });
  it('signal kinds and reason text map to the right tier', () => {
    expect(signalTier(sig('going'))).toBe(2);
    expect(signalTier(sig('friend'))).toBe(2);
    expect(signalTier(sig('soon'))).toBe(3);
    expect(signalTier(sig('interest'))).toBe(4);
    expect(signalTier(sig('trending'))).toBe(6);
    expect(reasonTier('Because you like Coffee')).toBe(4);
    expect(reasonTier('Sam is going')).toBe(2);
    expect(reasonTier('Sam is hosting this')).toBe(2);
    expect(reasonTier('Happening today')).toBe(3);
    expect(reasonTier('5 people attending')).toBe(6);
    expect(reasonTier('Great weather for this')).toBe(7);
    expect(reasonTier('Close by')).toBe(8);
    expect(reasonTier('something unrecognised')).toBe(8); // unknown is never stronger than a known reason
    expect(reasonTier(null)).toBe(8);
  });
  it('the strongest signal wins, and flags count', () => {
    expect(bestTier([sig('trending'), sig('interest')])).toBe(4);
    expect(bestTier([sig('trending')], { intent: true })).toBe(1);
    expect(bestTier([], { urgent: true })).toBe(3);
    expect(bestTier([], { business: true })).toBe(5);
    expect(bestTier([])).toBe(8);
  });
});

describe('Home ranking follows the priority', () => {
  it('a trending event never outranks an explicit ask', () => {
    const cards = [card('trend', [sig('trending', 'Trending nearby')]), card('asked', [sig('interest')], { interest_tag: 'Wine' })];
    expect(order(cards, { intentTags: new Set(['wine']) })[0]).toBe('asked');
    expect(order(cards)[0]).toBe('asked'); // even with no ask, interest still beats popularity
  });
  it('intent > friend > time > interest > business > popularity > weather > discovery', () => {
    const cards = [
      card('discovery', [sig('recommended', 'Close by')]),
      card('weather', [sig('recommended', 'Great weather for this')]),
      card('popular', [sig('trending', 'Trending nearby')]),
      card('interest', [sig('interest', 'Because you like Coffee')]),
      card('timed', [], {}, 30),
      card('friend', [sig('going', 'Sam is going')]),
      card('intent', [sig('trending')], { interest_tag: 'Wine' }),
    ];
    const recommended = [{ type: 'perk', id: 'p', title: 'Perk', reasons: [], data: {} }];
    const ids = order(cards, { recommended, intentTags: new Set(['wine']), max: 10 });
    expect(ids).toEqual(['intent', 'friend', 'timed', 'interest', 'perk-p', 'popular', 'weather', 'discovery']);
  });
  it('many weak signals cannot add up to beat one strong one', () => {
    const many = card('many', [sig('trending'), sig('recommended', 'Close by'), sig('recommended', 'Great weather for this'), sig('recommended', '5 people attending')]);
    const one = card('one', [sig('going', 'Sam is going')]);
    expect(order([many, one])).toEqual(['one', 'many']);
  });
  it('within a tier, more real reasons then the engines order break ties', () => {
    const a = card('a', [sig('interest')]);
    const b = card('b', [sig('interest'), sig('trending')]);
    expect(order([a, b])).toEqual(['b', 'a']);
    expect(order([card('x', [sig('interest')]), card('y', [sig('interest')])])).toEqual(['x', 'y']);
  });
  it('an ask that matches nothing changes nothing (no invented intent)', () => {
    const cards = [card('a', [sig('trending')]), card('b', [sig('interest')])];
    expect(order(cards, { intentTags: new Set(['karaoke']) })).toEqual(order(cards));
    expect(order(cards, { intentTags: new Set() })).toEqual(order(cards));
  });
});

describe('reasonKind (item 59): personalized / popular / social / time stay distinct', () => {
  const { reasonKind, REASON_KINDS } = require('./signalPriority');
  it('classifies each real reason into exactly one kind', () => {
    expect(reasonKind('Because you like Coffee')).toBe(REASON_KINDS.PERSONALIZED);
    expect(reasonKind('Trending nearby · 12 going')).toBe(REASON_KINDS.POPULAR);
    expect(reasonKind('Trending nearby')).toBe(REASON_KINDS.POPULAR);
    expect(reasonKind('8 people attending')).toBe(REASON_KINDS.POPULAR);
    expect(reasonKind('Sam is going')).toBe(REASON_KINDS.SOCIAL);
    expect(reasonKind('Sam is hosting this')).toBe(REASON_KINDS.SOCIAL);
    expect(reasonKind('Starting soon')).toBe(REASON_KINDS.TIME);
    expect(reasonKind('Happening today')).toBe(REASON_KINDS.TIME);
  });
  it('never labels facts or unknown text as one of the four', () => {
    expect(reasonKind('1.2 mi away')).toBeNull();
    expect(reasonKind('Great weather for this')).toBeNull();
    expect(reasonKind('something invented')).toBeNull();
  });
  it('trending never reads as personal', () => {
    expect(reasonKind({ kind: 'trending', text: 'Trending nearby' })).not.toBe(REASON_KINDS.PERSONALIZED);
  });
});
