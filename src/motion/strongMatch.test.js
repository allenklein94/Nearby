// Owner item 37 (2026-10-11): "Perfect Match" for activities -> the strong-match moment on a typed ask's top result.
const fs = require('fs');
const path = require('path');
const { strongMatchPieces } = require('../utils/strongMatch');
const { CLOSE_DISTANCE_MILES } = require('../constants/distanceWillingness');
const { SEQUENCES, settleMs, isWithinBudget } = require('./motionBudget');
const { translate } = require('../i18n/translate');

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');

// Frozen "now": Saturday 2026-10-10, 3 PM local.
const NOW = new Date(2026, 9, 10, 15, 0, 0);
beforeAll(() => jest.useFakeTimers({ now: NOW }));
afterAll(() => jest.useRealTimers());
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 9, 10 + dayOffset, h, m).toISOString();
const ask = { category: 'Coffee', dateWindow: 'tonight' };
const coffee = (extra = {}) => ({ type: 'gathering', category: 'Coffee', startsAt: at(19), distanceMiles: 0.4, ...extra });

describe('strongMatchPieces: all three stated pieces really match, or no claim', () => {
  test('activity + time + place -> the three pieces, in order', () => {
    expect(strongMatchPieces(coffee(), ask, NOW)).toEqual([
      { key: 'activity', value: 'Coffee' }, { key: 'time', value: at(19) }, { key: 'place', value: 0.4, approximate: true },
    ]);
  });
  test('a different activity, or an ask that named none -> nothing', () => {
    expect(strongMatchPieces(coffee({ category: 'Tea' }), ask, NOW)).toBeNull();
    expect(strongMatchPieces(coffee(), { dateWindow: 'tonight' }, NOW)).toBeNull();
  });
  test('time: unstated, flexible, unknown, outside the window, or before tonight -> nothing', () => {
    expect(strongMatchPieces(coffee(), { category: 'Coffee' }, NOW)).toBeNull();
    expect(strongMatchPieces(coffee(), { category: 'Coffee', dateWindow: 'flexible' }, NOW)).toBeNull();
    expect(strongMatchPieces(coffee({ startsAt: null }), ask, NOW)).toBeNull();
    expect(strongMatchPieces(coffee({ startsAt: at(19, 0, 1) }), ask, NOW)).toBeNull(); // tomorrow
    expect(strongMatchPieces(coffee({ startsAt: at(16) }), ask, NOW)).toBeNull(); // today, but not tonight
    expect(strongMatchPieces(coffee({ startsAt: at(16) }), { category: 'Coffee', dateWindow: 'today' }, NOW)).not.toBeNull();
  });
  test('place: unknown or not close -> nothing (the resolver\'s own close line)', () => {
    expect(strongMatchPieces(coffee({ distanceMiles: null }), ask, NOW)).toBeNull();
    expect(strongMatchPieces(coffee({ distanceMiles: CLOSE_DISTANCE_MILES }), ask, NOW)).toBeNull();
    expect(strongMatchPieces(coffee({ distanceMiles: CLOSE_DISTANCE_MILES - 0.1 }), ask, NOW)).not.toBeNull();
  });
  test('a business posting matches by its own posted start', () => {
    const posting = { type: 'business_availability', category: 'Coffee', postingStartsAt: at(20), distanceMiles: 1.1 };
    expect(strongMatchPieces(posting, ask, NOW)?.map((p) => p.key)).toEqual(['activity', 'time', 'place']);
  });
  test('missing input -> nothing', () => {
    expect(strongMatchPieces(null, ask, NOW)).toBeNull();
    expect(strongMatchPieces(coffee(), null, NOW)).toBeNull();
  });
});

describe('the moment: where it shows and how it moves', () => {
  test('wording is item 61\'s "A strong match for you", never "perfect", in every language', () => {
    expect(translate('en', 'vocab.confidence.high')).toBe('A strong match for you');
    for (const lang of ['es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      expect(translate(lang, 'vocab.confidence.high')).not.toBe('vocab.confidence.high');
    }
    expect(read('motion/StrongMatch.js')).not.toMatch(/[Pp]erfect (fit|match)'/);
  });
  test('item 38: the phrase is reserved for this rule - only the strong-match badge (and its own a11y labels) may say it', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'i18n' && e.name !== 'node_modules') walk(f); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(f);
    });
    walk(root);
    const users = files.filter((f) => /vocab\.confidence\.high|A strong match for you/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f)).sort();
    expect(users).toEqual(['motion/StrongMatch.js', 'screens/DiscoverHubScreen.js', 'screens/HomeScreen.js', 'utils/recommendationConfidence.js', 'utils/strongMatch.js']);
    // The screens say it only when the strong-match rule held for that row.
    for (const s of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js']) {
      for (const line of read(s).split('\n').filter((l) => /vocab\.confidence\.high/.test(l))) expect(line).toMatch(/strongPieces \? [^:]*vocab\.confidence\.high/);
    }
    // Item 61's card headline never speaks at 'high'.
    const { CARD_HEADLINE_LEVEL } = require('../utils/recommendationConfidence');
    expect(Object.values(CARD_HEADLINE_LEVEL)).not.toContain('high');
  });
  test('within its declared tier', () => {
    expect(isWithinBudget(settleMs('strongMatch'), SEQUENCES.strongMatch.tier)).toBe(true);
  });
  test('information readable from the first frame; native driver; no loop; no touches; no haptic; Reduce Motion settles', () => {
    const src = read('motion/StrongMatch.js');
    expect(src).toMatch(/opacity: infoOpacity\(steps\[i\]\)/);
    expect(src).toMatch(/opacity: infoOpacity\(badge\)/);
    expect(src).toMatch(/useNativeDriver: true/);
    expect(src).not.toMatch(/Animated\.loop|useNativeDriver: false/);
    expect(src).toMatch(/pointerEvents="none"/);
    expect(src).not.toMatch(/from '\.\/haptics'|Haptics\./);
    expect(src).toMatch(/if \(reduceMotion\) \{ steps\.forEach\(\(v\) => v\.setValue\(1\)\); badge\.setValue\(1\)/);
  });
  test('only the top pick of a typed ask on Home and Discover, decided by the one rule; otherwise the Nearby Pick badge', () => {
    for (const f of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js']) {
      const s = read(f);
      expect(s).toMatch(/const strongPieces = isTopPick \? strongMatchPieces\(item, intent(Results|Search)\?\.classifyResult\) : null;/);
      expect(s).toMatch(/\{strongPieces \? <StrongMatch [^>]*\/> : isTopPick && <NearbyPickBadge \/>\}/);
    }
    const users = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && /<StrongMatch\b/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(SRC, p));
      }
    };
    walk(SRC);
    expect(users.sort()).toEqual(['screens/DiscoverHubScreen.js', 'screens/HomeScreen.js']);
  });
});
