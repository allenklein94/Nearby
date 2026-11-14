import fs from 'fs';
import path from 'path';
import { appearanceFit, appearancePreferencesOf, rankDatingCandidates, COMPATIBILITY_BAND } from './datingAppearance';

const person = (id, compatibilityScore, { hair, eye, height } = {}) => ({
  id,
  compatibilityScore,
  profiles: { id, basics: { ...(hair ? { hair_color: hair } : {}), ...(eye ? { eye_color: eye } : {}) }, height_inches: height ?? null },
});
const ids = (list) => list.map((p) => p.id);

describe('appearanceFit', () => {
  const prefs = { hairColors: ['Blonde'], eyeColors: ['Blue', 'Green'], minHeightInches: 66, maxHeightInches: 74 };

  test('match, mismatch and missing', () => {
    expect(appearanceFit(prefs, person('a', 50, { hair: 'Blonde', eye: 'Blue', height: 70 }).profiles)).toBe(3);
    expect(appearanceFit(prefs, person('b', 50, { hair: 'Brown', eye: 'Brown', height: 60 }).profiles)).toBe(-3);
    expect(appearanceFit(prefs, person('c', 50).profiles)).toBe(0); // missing = neutral
  });

  test('several selected colors: any of them counts as a match', () => {
    expect(appearanceFit(prefs, person('g', 50, { eye: 'Green' }).profiles)).toBe(1);
    expect(appearanceFit({ hairColors: ['Blonde', 'Red'] }, person('r', 50, { hair: 'Red' }).profiles)).toBe(1);
  });

  test('no preference set = 0 for everyone', () => {
    expect(appearanceFit(appearancePreferencesOf({}), person('x', 50, { hair: 'Black', eye: 'Brown', height: 80 }).profiles)).toBe(0);
  });

  test('height: only min, only max, out of range', () => {
    expect(appearanceFit({ minHeightInches: 70 }, { height_inches: 72 })).toBe(1);
    expect(appearanceFit({ minHeightInches: 70 }, { height_inches: 68 })).toBe(-1);
    expect(appearanceFit({ maxHeightInches: 70 }, { height_inches: 71 })).toBe(-1);
    expect(appearanceFit({ minHeightInches: 70 }, { height_inches: null })).toBe(0);
  });
});

describe('rankDatingCandidates', () => {
  const blonde = { hairColors: ['Blonde'] };

  test('a mismatch is never removed', () => {
    const list = [person('brown', 80, { hair: 'Brown' }), person('blonde', 80, { hair: 'Blonde' })];
    const ranked = rankDatingCandidates(list, blonde);
    expect(ranked).toHaveLength(2);
    expect(ids(ranked)).toEqual(['blonde', 'brown']);
  });

  test('missing info sits between a match and a mismatch, never below a mismatch', () => {
    const list = [person('brown', 82, { hair: 'Brown' }), person('unknown', 82), person('blonde', 82, { hair: 'Blonde' })];
    expect(ids(rankDatingCandidates(list, blonde))).toEqual(['blonde', 'unknown', 'brown']);
  });

  test('appearance never outweighs a clearly higher compatibility (a different band)', () => {
    const list = [person('blondeLow', 61, { hair: 'Blonde', eye: 'Blue', height: 70 }), person('brownHigh', 75, { hair: 'Brown', eye: 'Brown', height: 60 })];
    const prefs = { hairColors: ['Blonde'], eyeColors: ['Blue'], minHeightInches: 66 };
    expect(ids(rankDatingCandidates(list, prefs))).toEqual(['brownHigh', 'blondeLow']);
  });

  test('within one band, appearance moves a match ahead modestly', () => {
    const list = [person('brown', 79, { hair: 'Brown' }), person('blonde', 71, { hair: 'Blonde' })];
    expect(Math.floor(79 / COMPATIBILITY_BAND)).toBe(Math.floor(71 / COMPATIBILITY_BAND));
    expect(ids(rankDatingCandidates(list, blonde))).toEqual(['blonde', 'brown']);
  });

  test('no preference = plain compatibility order, ties keep incoming order', () => {
    const list = [person('a', 40), person('b', 90), person('c', 40), person('d', 55)];
    expect(ids(rankDatingCandidates(list, appearancePreferencesOf({})))).toEqual(['b', 'd', 'a', 'c']);
  });

  test('unknown compatibility sorts after every known one', () => {
    const list = [person('none', null, { hair: 'Blonde' }), person('low', 3, { hair: 'Brown' })];
    expect(ids(rankDatingCandidates(list, blonde))).toEqual(['low', 'none']);
  });

  test('does not mutate the input', () => {
    const list = [person('a', 10), person('b', 90)];
    rankDatingCandidates(list, blonde);
    expect(ids(list)).toEqual(['a', 'b']);
  });
});

describe('wiring guard', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/proximity.js'), 'utf8');

  test('Dating reads never exclude by hair, eye color or height', () => {
    expect(src).not.toMatch(/hair_color\s*\)?\s*&&|includes\(candidateHairColor\)|includes\(candidateEyeColor\)/);
    expect(src).not.toMatch(/height_inches\s*<\s*heightMinPref|height_inches\s*>\s*heightMaxPref|candidateHeight\s*[<>]/);
  });

  test('Browse orders through the one shared rule; age + ethnicity filters stay', () => {
    expect(src).toMatch(/rankDatingCandidates\(candidates, appearancePreferencesOf\(myProfile\)\)/);
    expect(src).toMatch(/age < minAge \|\| age > maxAge/);
    expect(src).toMatch(/ethnicityPreferences\.includes/);
  });
});
