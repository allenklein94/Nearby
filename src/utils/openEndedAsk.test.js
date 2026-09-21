import { openEndedAskGroups, applyOpenEndedAsk, openEndedCaption, OPEN_ENDED_GROUP_BONUS } from './openEndedAsk';
import { SCORE_INTEREST_MATCH } from '../services/intentResolverScoring';

const ask = (rawText, extra = {}) => openEndedAskGroups({ rawText, ...extra });

describe('open-ended asks', () => {
  test('"something fun tonight with two friends" is open-ended; social groups only', () => {
    const g = ask('I want something fun tonight with two friends');
    expect(g).toEqual(expect.arrayContaining(['food_drink', 'activities_recreation', 'entertainment_nightlife']));
    ['home_local_services', 'auto_transportation', 'health_personal_care', 'business_networking', 'stay_getaway', 'pets'].forEach((k) => expect(g).not.toContain(k));
    expect(g).not.toContain('family_kids');
  });
  test('kid_friendly adds the family group', () => {
    expect(ask('something fun to do with the kids', { attributes: ['kid_friendly'] })).toContain('family_kids');
  });
  test('recognises the usual open phrasings', () => {
    ['anything to do this weekend', "I'm bored", 'what should we do tonight', 'want to go out tonight', 'looking for something interesting', 'somewhere to hang out']
      .forEach((t) => expect(ask(t)).not.toBeNull());
  });
  test('a real category, an occasion, or no open phrase turns it off', () => {
    expect(ask('something fun tonight', { category: 'Coffee' })).toBeNull();
    expect(ask('something fun for her birthday', { occasion: 'birthday' })).toBeNull();
    expect(ask('coffee with a friend')).toBeNull();
    expect(ask('')).toBeNull();
    expect(openEndedAskGroups({})).toBeNull();
    expect(openEndedAskGroups({ rawText: 42 })).toBeNull();
  });
  test('filters known non-social categories, keeps unknown ones, lifts eligible ones', () => {
    const groups = ask('something fun tonight');
    const items = [
      { id: 'concert', category: 'Concerts', score: 3 },
      { id: 'carwash', category: 'Car Wash', score: 9 },
      { id: 'dentist', category: 'Dental', score: 9 },
      { id: 'major', category: 'food_drink', score: 3 },
      { id: 'nocat', category: null, score: 3 },
    ];
    const out = applyOpenEndedAsk(items, groups);
    expect(out.map((c) => c.id)).toEqual(['concert', 'major', 'nocat']);
    expect(out.find((c) => c.id === 'concert').score).toBe(3 + OPEN_ENDED_GROUP_BONUS);
    expect(out.find((c) => c.id === 'nocat').score).toBe(3);
    expect(OPEN_ENDED_GROUP_BONUS).toBeLessThan(SCORE_INTEREST_MATCH);
  });
  test('null groups = untouched (a specific ask is never filtered)', () => {
    const items = [{ id: 'a', category: 'Car Wash', score: 1 }];
    expect(applyOpenEndedAsk(items, null)).toBe(items);
  });
  test('the caption names only groups the shown results come from', () => {
    const groups = ask('something fun tonight');
    expect(openEndedCaption([{ category: 'Concerts' }, { category: 'Concerts' }, { category: 'Coffee' }], groups)).toBe('Looking across Entertainment & Nightlife and Food & Drink');
    expect(openEndedCaption([{ category: null }], groups)).toBeNull();
    expect(openEndedCaption([{ category: 'Concerts' }], null)).toBeNull();
  });
  test('rule-based only: no AI or network in the module', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'openEndedAsk.js'), 'utf8');
    expect(src).not.toMatch(/fetch|supabase|anthropic|functions\.invoke/i);
  });
});
