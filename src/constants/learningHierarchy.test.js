// Owner item 158 (2026-10-03, LOCKED): explicit interest = strong, repeated behavior = growing, single click = weak.
import { becauseYouLikeCategories, blendedCategoryScore, behaviorNudge, EXPLICIT_POINTS, BEHAVIOR_MAX_POINTS } from './blendedRanking';

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

describe('the learning hierarchy', () => {
  it('a declared interest outweighs even maximal learned behavior on another category', () => {
    const declared = blendedCategoryScore('Coffee', { declared: ['Coffee'], behavior: {}, maturity: 1 });
    const learnedMax = blendedCategoryScore('Yoga', { declared: ['Coffee'], behavior: { Yoga: 12 }, maturity: 1 });
    expect(declared).toBe(EXPLICIT_POINTS);
    expect(learnedMax).toBe(BEHAVIOR_MAX_POINTS);
    expect(declared).toBeGreaterThan(learnedMax);
  });
  it('repeated behavior grows with repetition and with account maturity, up to the cap', () => {
    const at = (w, m) => behaviorNudge('Yoga', { behavior: { Yoga: w }, maturity: m });
    expect(at(3, 1)).toBeLessThan(at(6, 1));
    expect(at(6, 1)).toBeLessThan(at(12, 1));
    expect(at(40, 1)).toBe(at(12, 1));
    expect(at(12, 0.25)).toBeLessThan(at(12, 1));
  });
  it('a single click is not learned at all: the server bar (item 157) keeps it out of the behavior map', () => {
    const migrations = path.join(SRC, '..', 'supabase', 'migrations');
    const latest = fs.readdirSync(migrations).sort().filter((f) => fs.readFileSync(path.join(migrations, f), 'utf8').includes('function public.get_my_behavior_categories')).pop();
    expect(fs.readFileSync(path.join(migrations, latest), 'utf8')).toMatch(/>= public\.behavior_min_evidence\(\)/);
  });
});

describe('Home "Because you like" + Quick Picks order (becauseYouLikeCategories)', () => {
  it('declared interests come before learned-only categories, even heavily learned ones', () => {
    expect(becauseYouLikeCategories({ declared: ['Music', 'Hiking'], behavior: { Yoga: 12 }, maturity: 1 })).toEqual(['Music', 'Hiking', 'Yoga']);
  });
  it('behavior on a declared interest moves it up among the declared ones', () => {
    expect(becauseYouLikeCategories({ declared: ['Music', 'Hiking'], behavior: { Hiking: 6 }, maturity: 1 })).toEqual(['Hiking', 'Music']);
  });
  it('learned-only categories fill only when there is room, strongest first', () => {
    expect(becauseYouLikeCategories({ declared: ['A1', 'Music'], behavior: { Yoga: 3, Coffee: 9 }, maturity: 1 }, 3)).toEqual(['Music', 'Coffee', 'Yoga']);
  });
  it('a brand-new account (maturity 0) gets declared interests only; nothing declared or learned = empty', () => {
    expect(becauseYouLikeCategories({ declared: ['Music'], behavior: { Yoga: 12 }, maturity: 0 })).toEqual(['Music']);
    expect(becauseYouLikeCategories({ declared: [], behavior: {}, maturity: 1 })).toEqual([]);
  });
  it('never includes a broad group tag or a related hobby', () => {
    expect(becauseYouLikeCategories({ declared: ['Photography'], behavior: {}, maturity: 1 }, 10)).toEqual(['Photography']);
  });
});

describe('one behavior source', () => {
  it('no app code reads an all-time join count as behavior (it bypassed the evidence bar and Forget / Clear)', () => {
    const offenders = walk(SRC).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
      .filter((f) => /getMyTopGatheringCategories|ATTENDED_WEIGHT/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('personalization and Home read the learned signal', () => {
    expect(fs.readFileSync(path.join(SRC, 'hooks', 'usePersonalization.js'), 'utf8')).toMatch(/getMyBehaviorCategories\(/);
    expect(fs.readFileSync(path.join(SRC, 'services', 'homeDashboard.js'), 'utf8')).toMatch(/getMyLearnedAffinity\(/);
  });
});
