// Tattoos + piercings as soft Dating preferences, appearance capped at +/- 6 in total (owner, 2026-11-14).
import fs from 'fs';
import path from 'path';
import {
  APPEARANCE_MAX, appearanceAdjustment, appearanceFit, appearancePointsPerDimension, appearancePreferencesOf,
  browseRankScore, rankDatingCandidates,
} from './datingAppearance';
import { generateCompatibilityReport, APPEARANCE_ONLY_BASICS } from '../services/compatibility';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { isMissingColumnError, readWithOptionalColumns, writeWithOptionalColumns, withoutColumns } from './optionalProfileColumns';

const prefs = (over = {}) => appearancePreferencesOf({ dating_pref_hair_colors: [], dating_pref_eye_colors: [], ...over });
const person = (basics = {}, extra = {}) => ({ basics, ...extra });

describe('tattoos / piercings fit', () => {
  test('with: has = +1, none = -1; without: the reverse', () => {
    expect(appearanceFit(prefs({ dating_pref_tattoos: 'with' }), person({ tattoos: 'Has tattoos' }))).toBe(1);
    expect(appearanceFit(prefs({ dating_pref_tattoos: 'with' }), person({ tattoos: 'No tattoos' }))).toBe(-1);
    expect(appearanceFit(prefs({ dating_pref_piercings: 'without' }), person({ piercings: 'No piercings' }))).toBe(1);
    expect(appearanceFit(prefs({ dating_pref_piercings: 'without' }), person({ piercings: 'Has piercings' }))).toBe(-1);
  });

  test('unanswered or "Prefer not to say" is neutral, never treated as having neither', () => {
    for (const basics of [{}, { tattoos: 'Prefer not to say' }, { tattoos: null }]) {
      expect(appearanceFit(prefs({ dating_pref_tattoos: 'without' }), person(basics))).toBe(0);
      expect(appearanceFit(prefs({ dating_pref_tattoos: 'with' }), person(basics))).toBe(0);
    }
  });

  test('no preference (null / unknown stored value) leaves ranking unchanged', () => {
    const items = [
      { id: 'a', compatibilityScore: 50, profiles: person({ tattoos: 'Has tattoos', piercings: 'No piercings' }) },
      { id: 'b', compatibilityScore: 60, profiles: person({ tattoos: 'No tattoos' }) },
    ];
    for (const v of [null, undefined, 'maybe']) {
      const p = prefs({ dating_pref_tattoos: v, dating_pref_piercings: v });
      expect(appearancePointsPerDimension(p)).toBe(0);
      expect(rankDatingCandidates(items, p).map((x) => x.id)).toEqual(['b', 'a']);
    }
  });
});

describe('the whole appearance adjustment stays within +/- 6', () => {
  const all = prefs({
    dating_pref_hair_colors: ['Brown'], dating_pref_eye_colors: ['Green'], dating_pref_min_height_inches: 66,
    dating_pref_max_height_inches: 72, dating_pref_tattoos: 'with', dating_pref_piercings: 'without',
  });
  const perfect = person({ hair_color: 'Brown', eye_color: 'Green', tattoos: 'Has tattoos', piercings: 'No piercings' }, { height_inches: 70 });
  const opposite = person({ hair_color: 'Red', eye_color: 'Blue', tattoos: 'No tattoos', piercings: 'Has piercings' }, { height_inches: 60 });

  test('five preferences: each worth 1.2, total exactly +6 / -6', () => {
    expect(appearancePointsPerDimension(all)).toBeCloseTo(1.2);
    expect(appearanceAdjustment(all, perfect)).toBeCloseTo(APPEARANCE_MAX);
    expect(appearanceAdjustment(all, opposite)).toBeCloseTo(-APPEARANCE_MAX);
  });

  test('four preferences: each worth 1.5', () => {
    const four = prefs({ dating_pref_hair_colors: ['Brown'], dating_pref_eye_colors: ['Green'], dating_pref_tattoos: 'with', dating_pref_piercings: 'with' });
    expect(appearancePointsPerDimension(four)).toBe(1.5);
    expect(appearanceAdjustment(four, person({ hair_color: 'Brown', eye_color: 'Green', tattoos: 'Has tattoos', piercings: 'Has piercings' }))).toBe(6);
  });

  test('up to three preferences: exactly the accepted +/- 2 each (unchanged)', () => {
    expect(appearancePointsPerDimension(prefs({ dating_pref_hair_colors: ['Brown'] }))).toBe(2);
    expect(appearancePointsPerDimension(prefs({ dating_pref_hair_colors: ['Brown'], dating_pref_tattoos: 'with' }))).toBe(2);
    const three = prefs({ dating_pref_hair_colors: ['Brown'], dating_pref_eye_colors: ['Green'], dating_pref_min_height_inches: 66 });
    expect(appearancePointsPerDimension(three)).toBe(2);
    expect(browseRankScore(three, { compatibilityScore: 40, profiles: perfect })).toBe(46);
  });

  test('a partly answered profile only moves by the dimensions it answered', () => {
    expect(appearanceAdjustment(all, person({ tattoos: 'Has tattoos' }))).toBeCloseTo(1.2);
  });

  test('never excludes: everyone comes back, only the order changes', () => {
    const items = [
      { id: 'x', compatibilityScore: 70, profiles: opposite },
      { id: 'y', compatibilityScore: 65, profiles: perfect },
      { id: 'z', compatibilityScore: 68, profiles: person() },
    ];
    expect(rankDatingCandidates(items, all).map((i) => i.id)).toEqual(['y', 'z', 'x']);
    expect(rankDatingCandidates(items, all)).toHaveLength(3);
  });
});

describe('profile fields', () => {
  test('optional select basics with a "Prefer not to say" choice, marked appearance-only', () => {
    for (const key of ['tattoos', 'piercings']) {
      const f = BASICS_FIELDS.find((x) => x.key === key);
      expect(f).toMatchObject({ type: 'select', appearanceOnly: true });
      expect(f.options).toContain('Prefer not to say');
      expect(f.options).toHaveLength(3);
    }
  });

  test('never compared for compatibility (their influence is only the capped appearance adjustment)', () => {
    expect(APPEARANCE_ONLY_BASICS).toEqual(expect.arrayContaining(['tattoos', 'piercings']));
    const me = { basics: { tattoos: 'Has tattoos', piercings: 'No piercings', drinking: 'Socially' } };
    const them = { basics: { tattoos: 'Has tattoos', piercings: 'No piercings', drinking: 'Socially' } };
    const report = generateCompatibilityReport(me, them);
    const keys = [...report.matchingFields, ...report.differingFields].map((f) => f.key);
    expect(keys).toEqual(['drinking']);
  });

  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  test('never offered as a Discovery filter; an undisclosed answer is not shown on a profile', () => {
    expect(read('screens/DiscoveryScreen.js')).toMatch(/BASICS_FIELDS\.filter\(\(f\) => f\.type === 'select' && !f\.appearanceOnly\)/);
    expect(read('screens/ViewProfileScreen.js')).toMatch(/!\(f\.appearanceOnly && f\.value === 'Prefer not to say'\)/);
  });

  test('Dating Preferences reads and saves them only through the optional-column helper', () => {
    const screen = read('screens/DatingPreferencesScreen.js');
    expect(screen).toMatch(/readWithOptionalColumns\(readMyProfile, '[^']*dating_pref_tattoos, dating_pref_piercings/);
    expect(screen).toMatch(/await writeWithOptionalColumns\(/);
    expect(screen).toMatch(/\{presencePrefsAvailable && PRESENCE_CHOICES\.map/);
    expect(read('services/proximity.js')).toMatch(/readWithOptionalColumns\(readMyProfile, BROWSE_PROFILE_COLUMNS\)/);
  });
});

describe('works before 20270417 is live (errors exactly as PostgREST v13 returned them, checked 2026-11-14)', () => {
  const selectErr = { code: '42703', details: null, hint: null, message: 'column profiles.dating_pref_tattoos does not exist' };
  const rpcErr = { code: '42703', details: null, hint: null, message: 'column pgrst_call.dating_pref_tattoos does not exist' };
  const patchErr = { code: 'PGRST204', details: null, hint: null, message: "Could not find the 'dating_pref_piercings' column of 'profiles' in the schema cache" };

  test('recognises the missing-column errors, nothing else', () => {
    expect(isMissingColumnError(selectErr)).toBe(true);
    expect(isMissingColumnError(rpcErr)).toBe(true);
    expect(isMissingColumnError(patchErr)).toBe(true);
    expect(isMissingColumnError({ code: '42703', message: 'column profiles.age does not exist' })).toBe(false);
    expect(isMissingColumnError({ code: '500', message: 'dating_pref_tattoos' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });

  test('a read retries without the two columns and says they are unavailable', async () => {
    const asked = [];
    const res = await readWithOptionalColumns(async (cols) => {
      asked.push(cols);
      return cols.includes('dating_pref_tattoos') ? { data: null, error: selectErr } : { data: { id: 1 }, error: null };
    }, 'id, dating_pref_tattoos, dating_pref_piercings, basics');
    expect(asked).toEqual(['id, dating_pref_tattoos, dating_pref_piercings, basics', 'id, basics']);
    expect(res).toEqual({ data: { id: 1 }, error: null, available: false });
  });

  test('a write retries without the two keys; other errors are passed through untouched', async () => {
    const sent = [];
    const res = await writeWithOptionalColumns(async (row) => {
      sent.push(row);
      return 'dating_pref_piercings' in row ? { error: patchErr } : { error: null };
    }, { a: 1, dating_pref_tattoos: 'with', dating_pref_piercings: null });
    expect(sent[1]).toEqual({ a: 1 });
    expect(res).toEqual({ error: null, available: false });
    const other = await writeWithOptionalColumns(async () => ({ error: { code: '23514', message: 'check' } }), { a: 1 });
    expect(other).toEqual({ error: { code: '23514', message: 'check' }, available: true });
  });

  test('withoutColumns keeps everything else in order', () => {
    expect(withoutColumns('a, dating_pref_piercings, b, dating_pref_tattoos')).toBe('a, b');
  });
});
