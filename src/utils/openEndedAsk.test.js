import { openEndedAskGroups, applyOpenEndedAsk, openEndedCaption, timeTiltGroups, TIME_TILT_POINTS, OPEN_ENDED_GROUP_BONUS } from './openEndedAsk';
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
  test('time tilt: evening leans nightlife/food, daytime leans things to do, a date leans dating; unknown time = none', () => {
    expect(timeTiltGroups({ dateWindow: 'tonight' })).toEqual(['entertainment_nightlife', 'food_drink']);
    expect(timeTiltGroups({ dateWindow: 'today', hour: 19 })).toEqual(['entertainment_nightlife', 'food_drink']);
    expect(timeTiltGroups({ dateWindow: 'today', hour: 10 })).toContain('outdoors_nature');
    expect(timeTiltGroups({ dateWindow: 'weekend' })).toContain('attractions_things_to_see');
    expect(timeTiltGroups({ dateWindow: 'tonight', partyType: 'date' })).toContain('dating_social');
    expect(timeTiltGroups({ dateWindow: 'flexible' })).toEqual([]);
    expect(timeTiltGroups({ dateWindow: 'today' })).toContain('activities_recreation'); // no hour given -> not evening
    expect(timeTiltGroups({})).toEqual([]);
  });
  test('the tilt adds on top of the base lift and stays far below a real match', () => {
    const groups = ask('something fun tonight');
    const out = applyOpenEndedAsk([{ id: 'c', category: 'Concerts', score: 1 }, { id: 'h', category: 'Hiking', score: 1 }], groups, { dateWindow: 'tonight' });
    expect(out.find((c) => c.id === 'c').score).toBe(1 + OPEN_ENDED_GROUP_BONUS + TIME_TILT_POINTS);
    expect(out.find((c) => c.id === 'h').score).toBe(1 + OPEN_ENDED_GROUP_BONUS);
    expect(OPEN_ENDED_GROUP_BONUS + TIME_TILT_POINTS).toBeLessThan(SCORE_INTEREST_MATCH);
  });
  test('Home and Discover both render the caption', () => {
    const fs = require('fs'); const path = require('path');
    ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js'].forEach((f) => expect(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')).toMatch(/openEndedNote/));
  });
});
