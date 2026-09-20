import { mergeHomeGatheringSignals } from './homeSignalMerge';

const g = (id, extra = {}) => ({ id, title: `G${id}`, interest_tag: 'Coffee', ...extra });

describe('mergeHomeGatheringSignals (one object, multiple signals)', () => {
  test('the same gathering in three lists renders once with three reasons', () => {
    const { hero, cards } = mergeHomeGatheringSignals({
      becauseYouLike: [g(1)],
      trending: [g(1, { approvedAttendees: [1, 2] })],
      friends: [g(1, { profiles: { display_name: 'Sam' } })],
    });
    expect(hero).toBeNull();
    expect(cards).toHaveLength(1);
    expect(cards[0].reasons).toEqual(['Because you like Coffee', 'Trending nearby', 'Sam is hosting this']);
    expect(cards[0].gathering.approvedAttendees).toHaveLength(2);
    expect(cards[0].gathering.profiles.display_name).toBe('Sam');
  });

  test('Best Pick keeps the hero and absorbs the other reasons; it is not repeated as a card', () => {
    const { hero, cards } = mergeHomeGatheringSignals({
      bestPick: g(1, { reasons: ['Close by'] }),
      becauseYouLike: [g(1), g(2)],
      trending: [g(1)],
    });
    expect(hero.reasons).toEqual(['Close by', 'Because you like Coffee', 'Trending nearby']);
    expect(cards.map((c) => c.gathering.id)).toEqual([2]);
  });

  test('a reason already on the hero is not duplicated', () => {
    const { hero } = mergeHomeGatheringSignals({ bestPick: g(1, { reasons: ['Trending nearby'] }), trending: [g(1)] });
    expect(hero.reasons).toEqual(['Trending nearby']);
  });

  test('more reasons sort first; ties keep first-appearance order', () => {
    const { cards } = mergeHomeGatheringSignals({
      becauseYouLike: [g(1), g(2)],
      trending: [g(3), g(2)],
    });
    expect(cards.map((c) => c.gathering.id)).toEqual([2, 1, 3]);
  });

  test('friend past/future wording and flags', () => {
    const { cards } = mergeHomeGatheringSignals({
      friends: [g(1, { profiles: { display_name: 'Sam' } }), g(2)],
      trending: [g(3)],
      isPast: (x) => x.id === 1,
    });
    const by = Object.fromEntries(cards.map((c) => [c.gathering.id, c]));
    expect(by[1].reasons).toEqual(['Sam hosted this']);
    expect(by[2].reasons).toEqual(['A friend is hosting this']);
    expect(by[1].hasFriend).toBe(true);
    expect(by[3].trendingOnly).toBe(true);
  });

  test('empty inputs produce nothing; no signal is invented', () => {
    expect(mergeHomeGatheringSignals()).toEqual({ hero: null, cards: [] });
  });
});

describe('Home renders merged cards, not one list per signal', () => {
  const fs = require('fs');
  const path = require('path');
  const home = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
  test('Home builds its gathering cards through the merge', () => {
    expect(home).toMatch(/mergeHomeGatheringSignals\(/);
    expect(home).toMatch(/homeMerge\.cards\.map/);
  });
  test('the per-signal lists are not rendered directly any more', () => {
    expect(home).not.toMatch(/dashboard\.trendingGatherings\.map/);
    expect(home).not.toMatch(/dashboard\.friendsActivity\.map/);
    expect(home).not.toMatch(/dashboard\.becauseYouLike\.map/);
  });
});
