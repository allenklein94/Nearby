const fs = require('fs');
const path = require('path');
const { understoodPieces, understoodKey, takeUnderstoodPlay, _resetUnderstoodPlays } = require('./askUnderstood');
const { SEQUENCES, settleMs, tierOf } = require('../motion/motionBudget');

// Owner item 45 (2026-10-11): the search understanding moment.
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('which pieces show', () => {
  test('"something fun outside tonight" -> Tonight · Outdoor (no chip for "fun")', () => {
    expect(understoodPieces({ dateWindow: 'tonight', category: null }, 'something fun outside tonight'))
      .toEqual([{ key: 'when', window: 'tonight' }, { key: 'where', environment: 'outdoor' }]);
  });
  test('order is WHAT, WHEN, WHERE, WHO', () => {
    const p = understoodPieces({ category: 'Hiking', dateWindow: 'weekend', partyType: 'groups' }, 'a big group hike outdoors this weekend');
    expect(p.map((x) => x.key)).toEqual(['what', 'when', 'where', 'who']);
  });
  test('a category beats the narrowed group; the group shows when there is no category', () => {
    expect(understoodPieces({ category: 'Sushi', narrowGroup: 'food' }, 'sushi')[0]).toEqual({ key: 'what', category: 'Sushi' });
    expect(understoodPieces({ narrowGroup: 'food' }, 'food')[0]).toEqual({ key: 'what', group: 'food' });
  });
  test('unknown = no chip: no time said, unrecognised window, no environment', () => {
    expect(understoodPieces({ dateWindow: 'flexible' }, 'something fun')).toEqual([]);
    expect(understoodPieces({}, 'anything')).toEqual([]);
    expect(understoodPieces(null, null)).toEqual([]);
  });
  test('a negated environment is never shown as the environment', () => {
    expect(understoodPieces({}, 'nothing outdoors tonight please').find((p) => p.key === 'where')).toBeUndefined();
  });
  test('sitting outside AT a place is not an outdoor activity', () => {
    expect(understoodPieces({ category: 'Coffee' }, 'coffee where we can sit outside').find((p) => p.key === 'where')).toBeUndefined();
  });
  test('never repeats a refinement chip (friends / date / solo are item 107 chips)', () => {
    for (const partyType of ['friends', 'date', 'solo']) {
      expect(understoodPieces({ partyType }, 'x').find((p) => p.key === 'who')).toBeUndefined();
    }
  });
  test('an "unclear" intent still shows what was read (the deterministic classifier calls the owner example unclear)', () => {
    expect(understoodPieces({ intent: 'unclear', dateWindow: 'tonight' }, 'something fun outside tonight'))
      .toEqual([{ key: 'when', window: 'tonight' }, { key: 'where', environment: 'outdoor' }]);
  });
  test('nothing for a business proposal', () => {
    expect(understoodPieces({ intent: 'business_partner', dateWindow: 'tonight' }, 'tonight')).toEqual([]);
  });
  test("the resolver's own facets win over re-reading the words", () => {
    expect(understoodPieces({ structured: { facets: { environment: null } } }, 'outside').find((p) => p.key === 'where')).toBeUndefined();
    expect(understoodPieces({ structured: { facets: { environment: 'indoor' } } }, 'x')).toEqual([{ key: 'where', environment: 'indoor' }]);
  });
});

describe('plays once per understood ask', () => {
  beforeEach(() => _resetUnderstoodPlays());
  test('the loader handing over to the results, a refine or a re-render never replays it', () => {
    const pieces = understoodPieces({ dateWindow: 'tonight' }, 'fun outside tonight');
    const key = understoodKey(pieces, 'fun outside tonight');
    expect(takeUnderstoodPlay(key)).toBe(true);
    expect(takeUnderstoodPlay(understoodKey(pieces, '  Fun outside tonight '))).toBe(false);
  });
  test('a differently understood ask plays', () => {
    takeUnderstoodPlay(understoodKey(understoodPieces({ dateWindow: 'tonight' }, 'x'), 'x'));
    expect(takeUnderstoodPlay(understoodKey(understoodPieces({ dateWindow: 'today' }, 'x'), 'x'))).toBe(true);
  });
});

describe('motion and presentation', () => {
  const comp = read('src/components/AskUnderstoodChips.js');
  test('small tier', () => {
    expect(SEQUENCES.askUnderstood.tier).toBe('small');
    expect(tierOf(settleMs('askUnderstood'))).toBe('small');
  });
  test('readable from frame one, native driver, Reduce Motion = already there, takes no touches', () => {
    expect(comp).toMatch(/opacity: infoOpacity\(steps\[i\]\)/);
    expect(comp).toMatch(/useNativeDriver: true/);
    expect(comp).not.toMatch(/useNativeDriver: false/);
    expect(comp).toMatch(/&& !reduceMotion\)/);
    expect(comp).toMatch(/pointerEvents="none"/);
  });
  test('quiet: never coral, no new strings (reuses existing labels)', () => {
    expect(comp).not.toMatch(/colors\.primary/);
    expect(comp).toMatch(/ui\.gatherings\.dateFilter\./);
    expect(comp).toMatch(/ui\.gatherings\.envOutdoorChip/);
  });
});

describe('where it shows', () => {
  const home = read('src/screens/HomeScreen.js');
  const discover = read('src/screens/DiscoverHubScreen.js');
  test('Home and Discover: under the Finding loader once understood, and first in the results', () => {
    for (const src of [home, discover]) {
      expect(src).toMatch(/intentPhase\?\.phase === 'finding' && <AskUnderstoodChips classifyResult=\{intentPhase\.classifyResult\} typedText=\{intentPhase\.typedText\} \/>/);
    }
    expect(home).toMatch(/<View style=\{styles\.intentResults\}>\s*<AskUnderstoodChips classifyResult=\{intentResults\.classifyResult\}/);
    expect(discover).toMatch(/<View style=\{styles\.intentSearchBlock\}>\s*<AskUnderstoodChips classifyResult=\{intentSearch\.classifyResult\}/);
  });
  test('Discover has one representation: the old static tag row is gone', () => {
    expect(discover).not.toMatch(/intentSearchTagsRow|ui\.discover\.tagNearby/);
  });
});
