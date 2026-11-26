// Appearance is never compatibility (owner, 2026-11-14): hair color, eye color, height (and tattoos, piercings) count
// only in Browse's capped appearance adjustment, never in the 35% profile-answer part of compatibility.
//
// "Before" is reproduced exactly by renaming the appearance keys, so the same function compares them as ordinary
// answers again (the comparison is key-generic). The numbers below are the real outputs of generateCompatibilityReport.
import { generateCompatibilityReport, calculateCompatibility, APPEARANCE_ONLY_BASICS, NEVER_COMPARED_BASICS } from './compatibility';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { APPEARANCE_MAX, appearanceAdjustment, browseRankScore, rankDatingCandidates } from '../utils/datingAppearance';

const LOOK_KEYS = ['hair_color', 'eye_color', 'height'];
const asBefore = (profile) => ({
  ...profile,
  basics: Object.fromEntries(Object.entries(profile.basics ?? {}).map(([k, v]) => [LOOK_KEYS.includes(k) ? `legacy_${k}` : k, v])),
});
const before = (a, b) => calculateCompatibility(asBefore(a), asBefore(b));

// The viewer.
const maya = {
  interests: ['Hiking', 'Coffee', 'Live Music', 'Yoga', 'Cooking'],
  relationship_intention: ['Long-term relationship'],
  basics: {
    height: "5'6\"", hair_color: 'Brown', eye_color: 'Brown',
    drinking: 'Sometimes', smoking: 'No', family_plans: 'Want children', workout: 'Often', pets: 'Dog',
    weekend_style: 'A mix of both', communication_style: 'Balanced',
  },
};
// Looks like Maya, shares nothing else.
const lookalike = {
  interests: ['Nightlife', 'Gaming', 'Fashion'],
  relationship_intention: ['Something casual'],
  basics: {
    height: "5'6\"", hair_color: 'Brown', eye_color: 'Brown',
    drinking: 'Yes', smoking: 'Sometimes', family_plans: "Don't want children", workout: 'Never', pets: 'Cat',
    weekend_style: 'Always out and about', communication_style: 'Big texter',
  },
};
// Looks nothing like Maya, shares her interests and values.
const kindred = {
  interests: ['Hiking', 'Coffee', 'Live Music', 'Travel'],
  relationship_intention: ['Long-term relationship'],
  basics: {
    height: "6'1\"", hair_color: 'Blonde', eye_color: 'Blue',
    drinking: 'Sometimes', smoking: 'No', family_plans: 'Want children', workout: 'Often', pets: 'Dog',
    weekend_style: 'A mix of both', communication_style: 'Phone caller',
  },
};
// Mixed: some interests, some values, same hair.
const mixed = {
  interests: ['Coffee', 'Yoga', 'Art'],
  relationship_intention: ['Long-term relationship'],
  basics: {
    hair_color: 'Brown', eye_color: 'Green',
    drinking: 'Sometimes', smoking: 'No', family_plans: 'Not sure yet', workout: 'Sometimes',
  },
};
// Answered no appearance basics at all.
const noLooks = {
  interests: ['Hiking', 'Cooking'],
  relationship_intention: ['Long-term relationship'],
  basics: { drinking: 'Sometimes', smoking: 'No', family_plans: 'Want children' },
};
// Both answered ONLY appearance basics: the profile part disappears and its weight is redistributed.
const looksOnlyMe = { interests: ['Hiking', 'Coffee'], basics: { hair_color: 'Brown', eye_color: 'Brown', height: "5'6\"" } };
const looksOnlyThem = { interests: ['Hiking', 'Board Games'], basics: { hair_color: 'Brown', eye_color: 'Brown', height: "5'6\"" } };

describe('before -> after on realistic profiles (exact percentages)', () => {
  test.each([
    ['lookalike (same hair, eyes, height; nothing else shared)', maya, lookalike, 11, 0],
    ['kindred (different look; shared interests + values)', maya, kindred, 56, 65],
    ['mixed (same hair only; some interests + values)', maya, mixed, 43, 44],
    ['no appearance answers (unchanged)', maya, noLooks, 65, 65],
    ['both answered only appearance basics', looksOnlyMe, looksOnlyThem, 61, 33],
  ])('%s', (_label, a, b, was, now) => {
    expect(before(a, b)).toBe(was);
    expect(calculateCompatibility(a, b)).toBe(now);
  });

  test('the ordering flips the right way: values beat looks', () => {
    expect(before(maya, lookalike)).toBeGreaterThan(0);
    expect(calculateCompatibility(maya, lookalike)).toBe(0);
    expect(calculateCompatibility(maya, kindred)).toBeGreaterThan(before(maya, kindred));
  });

  test('symmetric: the same figure from either side', () => {
    for (const other of [lookalike, kindred, mixed, noLooks]) {
      expect(calculateCompatibility(maya, other)).toBe(calculateCompatibility(other, maya));
    }
  });
});

describe('no appearance attribute reaches base compatibility', () => {
  test('a report never lists an appearance answer as matching or differing', () => {
    for (const other of [lookalike, kindred, mixed, looksOnlyThem]) {
      const r = generateCompatibilityReport(maya, other);
      const keys = [...r.matchingFields, ...r.differingFields].map((f) => f.key);
      for (const k of APPEARANCE_ONLY_BASICS) expect(keys).not.toContain(k);
    }
  });

  test('every basic describing how someone looks is excluded (new appearance fields must be added here too)', () => {
    const appearanceFields = ['height', 'hair_color', 'eye_color', 'tattoos', 'piercings'];
    for (const k of appearanceFields) expect(BASICS_FIELDS.some((f) => f.key === k)).toBe(true);
    expect([...APPEARANCE_ONLY_BASICS].sort()).toEqual([...appearanceFields].sort());
    // Fields marked appearanceOnly in the schema are covered too.
    for (const f of BASICS_FIELDS.filter((x) => x.appearanceOnly)) expect(APPEARANCE_ONLY_BASICS).toContain(f.key);
    // The remaining comparable basics: none is an appearance trait.
    const comparable = BASICS_FIELDS.map((f) => f.key).filter((k) => !APPEARANCE_ONLY_BASICS.includes(k) && !NEVER_COMPARED_BASICS.includes(k));
    expect(comparable.filter((k) => /hair|eye|height|tattoo|pierc|body|build|weight|skin|ethnic/.test(k))).toEqual([]);
  });

  test('the 50 / 35 / 15 structure is unchanged: profile answers still weigh 35 against interests 50', () => {
    const a = { interests: ['Hiking', 'Coffee'], basics: { drinking: 'Sometimes', smoking: 'No' } };
    const b = { interests: ['Hiking', 'Coffee'], basics: { drinking: 'Yes', smoking: 'Yes' } }; // interests 1.0, answers 0.0
    expect(calculateCompatibility(a, b)).toBe(Math.round((1 * 0.5) / 0.85 * 100)); // 59
  });
});

describe('appearance stays in the capped adjustment only', () => {
  const allFive = { hairColors: ['Brown'], eyeColors: ['Brown'], minHeightInches: 60, maxHeightInches: 70, tattoos: 'without', piercings: 'without' };
  const perfect = { basics: { hair_color: 'Brown', eye_color: 'Brown', tattoos: 'No tattoos', piercings: 'No piercings' }, height_inches: 66 };
  const opposite = { basics: { hair_color: 'Blonde', eye_color: 'Blue', tattoos: 'Has tattoos', piercings: 'Has piercings' }, height_inches: 74 };

  test('still capped at +/- 6 with every preference set', () => {
    expect(APPEARANCE_MAX).toBe(6);
    expect(appearanceAdjustment(allFive, perfect)).toBeCloseTo(6);
    expect(appearanceAdjustment(allFive, opposite)).toBeCloseTo(-6);
  });

  test('hair, eye and height still order Browse (only through the adjustment)', () => {
    const prefs = { hairColors: ['Brown'], eyeColors: ['Brown'], minHeightInches: 64, maxHeightInches: 68 };
    const lookalikeItem = { profiles: { ...lookalike, height_inches: 66 }, compatibilityScore: calculateCompatibility(maya, lookalike) };
    const kindredItem = { profiles: { ...kindred, height_inches: 73 }, compatibilityScore: calculateCompatibility(maya, kindred) };
    expect(browseRankScore(prefs, lookalikeItem)).toBe(0 + 6);
    expect(browseRankScore(prefs, kindredItem)).toBe(65 - 6);
    expect(rankDatingCandidates([lookalikeItem, kindredItem], prefs)[0]).toBe(kindredItem);
  });
});
