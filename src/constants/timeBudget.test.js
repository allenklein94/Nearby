const fs = require('fs');
const path = require('path');
const { TAG_TYPICAL_MINUTES, timeBudgetFromText, lengthOf, lengthPhrase, timeFit, applyTimeBudgetToCandidates, timeBudgetCaption } = require('./timeBudget');
const { CATEGORY_GROUPS } = require('./gatheringCategories');
const { resolveAsk } = require('../utils/askResolver');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('reading the person\'s available time (item 68)', () => {
  it('stated amounts of time', () => {
    const cases = {
      'I only have an hour': 60, 'we have about 2 hours': 120, 'I have 30 minutes': 30, 'only got half an hour': 30,
      'I have an hour and a half': 90, 'we have a couple of hours tonight': 120, 'something for an hour': 60,
      'I\'ve got 45 mins before dinner': 45, 'under an hour': 60, 'free for a few hours': 180,
    };
    for (const [t, m] of Object.entries(cases)) expect([t, timeBudgetFromText(t)]).toEqual([t, m]);
    expect(resolveAsk('I only have an hour').timeBudgetMinutes).toBe(60);
  });
  it('not a budget: an activity\'s own length, vague speed words, times of day', () => {
    for (const t of ['a 2 hour hike', 'something quick', 'coffee tonight', 'happy hour', 'dinner at 7', 'a 3-hour cooking class', 'what should we do']) {
      expect([t, timeBudgetFromText(t)]).toEqual([t, null]);
    }
  });
});

describe('a result\'s length: declared first, else a well-known category norm', () => {
  it('typical lengths use real tags only (the owner\'s examples included)', () => {
    const tags = new Set(CATEGORY_GROUPS.flatMap((g) => g.tags));
    Object.keys(TAG_TYPICAL_MINUTES).forEach((t) => expect(tags.has(t) ? t : `unknown tag ${t}`).toBe(t));
    expect([TAG_TYPICAL_MINUTES.Coffee, TAG_TYPICAL_MINUTES['Mini Golf'], TAG_TYPICAL_MINUTES.Movies, TAG_TYPICAL_MINUTES.Hiking]).toEqual([45, 90, 120, 150]);
  });
  it('host-declared wins and reads as a fact; a norm reads as "usually"', () => {
    expect(lengthOf({ category: 'Hiking', durationMinutes: 60 })).toEqual({ minutes: 60, declared: true });
    expect(lengthPhrase(lengthOf({ category: 'Hiking', durationMinutes: 60 }))).toBe('About 1 hr');
    expect(lengthPhrase(lengthOf({ category: 'Coffee' }))).toBe('Usually about 45 min');
    expect(lengthOf({ category: 'Pottery' })).toBeNull();
    expect(lengthOf({})).toBeNull();
  });
});

describe('ranking against the budget', () => {
  it('"I only have an hour": coffee up, a movie and a hike down, unknown untouched, nothing removed', () => {
    const cands = [
      { id: 'coffee', category: 'Coffee', score: 0 },
      { id: 'movie', category: 'Movies', score: 0 },
      { id: 'hike', category: 'Hiking', score: 0 },
      { id: 'short-hike', category: 'Hiking', durationMinutes: 60, score: 0 },
      { id: 'pottery', category: 'Pottery', score: 0 },
    ];
    const out = applyTimeBudgetToCandidates(cands, 60);
    expect(out.map((c) => [c.id, c.score])).toEqual([['coffee', 2], ['movie', -2], ['hike', -2], ['short-hike', 2], ['pottery', 0]]);
    expect(out[0].subtitle).toBe('⏱️ Usually about 45 min');
    expect(out[3].subtitle).toBe('⏱️ About 1 hr');
    expect(out[4]).toBe(cands[4]);
    expect(applyTimeBudgetToCandidates(cands, null)).toBe(cands);
  });
  it('a little over the budget is neutral, not penalised', () => {
    expect(timeFit({ category: 'Bowling' }, 75).delta).toBe(0); // 90 min vs 75
    expect(timeFit({ category: 'Bowling' }, 60).delta).toBe(-2);
  });
  it('the caption says what it did', () => {
    expect(timeBudgetCaption(60)).toBe('Picking things that fit in about an hour');
    expect(timeBudgetCaption(90)).toBe('Picking things that fit in about 1.5 hr');
    expect(timeBudgetCaption(null)).toBeNull();
  });
});

describe('wiring and scope', () => {
  it('the resolver applies it and captions it', () => {
    const r = read('src/services/intentResolver.js');
    expect(r).toContain('applyTimeBudgetToCandidates(deduped, timeBudget)');
    expect(r).toContain('timeBudgetCaption(timeBudget)');
  });
  it('typed requests only; never AI; nothing to businesses', () => {
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/services/homeDashboard.js']) {
      if (fs.existsSync(path.join(ROOT, f))) expect([f, /timeBudget/.test(read(f))]).toEqual([f, false]);
    }
    expect(read('src/constants/timeBudget.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
});

describe('business postings get a length from their declared tags (no owner-typed duration)', () => {
  it('reads subcategory and secondary tags after a major category', () => {
    expect(lengthOf({ category: 'food_drink', subcategory: 'Coffee' })).toEqual({ minutes: 45, declared: false });
    expect(lengthOf({ category: 'entertainment_nightlife', categories: ['Mini Golf'] })).toEqual({ minutes: 90, declared: false });
    expect(lengthOf({ category: 'food_drink' })).toBeNull();
  });
});
