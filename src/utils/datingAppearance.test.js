import fs from 'fs';
import path from 'path';
import { appearanceFit, appearancePreferencesOf, browseRankScore, rankDatingCandidates, APPEARANCE_POINTS } from './datingAppearance';

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

describe('rankDatingCandidates (fixed +/-2 per dimension, no bands)', () => {
  const blonde = { hairColors: ['Blonde'] };
  const all3 = { hairColors: ['Blonde'], eyeColors: ['Blue'], minHeightInches: 66 };
  const match3 = { hair: 'Blonde', eye: 'Blue', height: 70 };
  const miss3 = { hair: 'Brown', eye: 'Brown', height: 60 };

  test('points per dimension', () => {
    expect(APPEARANCE_POINTS).toBe(2);
    expect(browseRankScore(all3, person('m', 75, match3))).toBe(81);
    expect(browseRankScore(all3, person('x', 80, miss3))).toBe(74);
    expect(browseRankScore(all3, person('u', 90))).toBe(90); // missing data = 0
  });

  test("owner's example: 75% all-match > 80% all-mismatch, 90% unknown stays first", () => {
    const list = [person('A', 80, miss3), person('B', 75, match3), person('C', 90)];
    expect(ids(rankDatingCandidates(list, all3))).toEqual(['C', 'B', 'A']);
  });

  test('a mismatch is never removed', () => {
    const list = [person('brown', 80, { hair: 'Brown' }), person('blonde', 80, { hair: 'Blonde' })];
    expect(ids(rankDatingCandidates(list, blonde))).toEqual(['blonde', 'brown']);
  });

  test('no band edges: the same gap behaves the same at 79/70 and at 70/69', () => {
    // 9-point gap: full match (+6) vs full mismatch (-6) = 12 swing, so the match passes, at any score.
    expect(ids(rankDatingCandidates([person('hi', 79, miss3), person('lo', 70, match3)], all3))).toEqual(['lo', 'hi']);
    expect(ids(rankDatingCandidates([person('hi', 70, miss3), person('lo', 61, match3)], all3))).toEqual(['lo', 'hi']);
    // 1-point gap across the old 80 edge: full match passes too (was blocked by the band).
    expect(ids(rankDatingCandidates([person('hi', 80, miss3), person('lo', 79, match3)], all3))).toEqual(['lo', 'hi']);
  });

  test('maximum swing is 12: a 13-point gap always holds, even all-match vs all-mismatch', () => {
    expect(ids(rankDatingCandidates([person('hi', 83, miss3), person('lo', 70, match3)], all3))).toEqual(['hi', 'lo']);
  });

  test('a 12-point gap ties on rank and the exact compatibility breaks it', () => {
    expect(ids(rankDatingCandidates([person('lo', 70, match3), person('hi', 82, miss3)], all3))).toEqual(['hi', 'lo']);
  });

  test('missing data vs full match: the match passes a gap under 6; at 6 the higher real score wins the tie', () => {
    expect(ids(rankDatingCandidates([person('unk', 75), person('m', 70, match3)], all3))).toEqual(['m', 'unk']);
    expect(ids(rankDatingCandidates([person('unk', 76), person('m', 70, match3)], all3))).toEqual(['unk', 'm']);
  });

  test('missing info sits between a match and a mismatch', () => {
    const list = [person('brown', 82, { hair: 'Brown' }), person('unknown', 82), person('blonde', 82, { hair: 'Blonde' })];
    expect(ids(rankDatingCandidates(list, blonde))).toEqual(['blonde', 'unknown', 'brown']);
  });

  test('several selected colors: any counts as a match', () => {
    const prefs = { hairColors: ['Blonde', 'Red'], eyeColors: ['Blue', 'Green'] };
    const list = [person('black', 70, { hair: 'Black', eye: 'Brown' }), person('red', 70, { hair: 'Red', eye: 'Green' })];
    expect(ids(rankDatingCandidates(list, prefs))).toEqual(['red', 'black']);
  });

  test('no preference = the previous Browse order exactly (compatibility desc, null as 0, ties in incoming order)', () => {
    const list = [person('a', 40, match3), person('b', 90, miss3), person('c', 40), person('n', null), person('z', 0), person('d', 55)];
    const previous = [...list].sort((x, y) => (y.compatibilityScore ?? 0) - (x.compatibilityScore ?? 0));
    expect(ids(rankDatingCandidates(list, appearancePreferencesOf({})))).toEqual(ids(previous));
    expect(ids(rankDatingCandidates(list, appearancePreferencesOf({})))).toEqual(['b', 'd', 'a', 'c', 'n', 'z']);
  });

  test('does not mutate the input or the shown score', () => {
    const list = [person('a', 10, match3), person('b', 90)];
    rankDatingCandidates(list, all3);
    expect(ids(list)).toEqual(['a', 'b']);
    expect(list[0].compatibilityScore).toBe(10);
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
