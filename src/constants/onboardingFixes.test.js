// Owner, 2026-11-22 (staging iPhone onboarding findings): interests typed without commas are never silently lost; the
// social-plans answer allows several choices ('open' exclusive), is stored in the same column, ranks only, and is editable
// in Edit Profile. PRODUCT_AUDIT/STAGING_IPHONE_ONBOARDING_FINDINGS_2026-11-22.md.
import { mapAnythingElse } from './onboardingInterests';
import { COMFORT_LEVELS, parseComfortLevels, serializeComfortLevels, toggleComfortLevel, comfortFits } from './socialComfort';
import { profileFormSnapshot, isProfileFormDirty } from '../utils/profileEditDirty';
import { buildHomeRecommendations } from '../services/homeRecommendations';

const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
const ui = require('../i18n/ui/onboarding').default;

describe('"Anything else?" never drops an interest silently', () => {
  it('reads an entry typed without commas the same as the comma version', () => {
    expect(mapAnythingElse('Pickleball hockey board games')).toEqual(mapAnythingElse('Pickleball, hockey, board games'));
    expect(mapAnythingElse('Pickleball hockey board games').tags).toEqual(['Pickleball', 'Sports', 'Board Games']);
  });
  it('new lines separate entries too', () => {
    expect(mapAnythingElse('pickleball\nhockey\nboard games').tags).toEqual(['Pickleball', 'Sports', 'Board Games']);
  });
  it('shows every word it could not recognise, beside what it did', () => {
    expect(mapAnythingElse('pickleball zorbing hockey')).toEqual({ tags: ['Pickleball', 'Sports'], groups: [], unmatched: ['zorbing'] });
    expect(mapAnythingElse('I like pickleball and xyzzy').unmatched).toEqual(['xyzzy']);
    expect(mapAnythingElse('xyzzy').unmatched).toEqual(['xyzzy']);
  });
  it('a fully understood entry keeps its old result (format/setting words still give way to the activity)', () => {
    expect(mapAnythingElse('yoga class')).toEqual({ tags: ['Yoga'], groups: [], unmatched: [] });
    expect(mapAnythingElse('outdoor yoga').tags).toEqual(['Yoga']);
    expect(mapAnythingElse('outdoors').tags).toEqual(['Outdoors']);
  });
  it('keeps the frozen taxonomy: hockey is Sports, a cuisine is not an interest', () => {
    expect(mapAnythingElse('hockey').tags).toEqual(['Sports']);
    expect(mapAnythingElse('Italian')).toEqual({ tags: [], groups: [], unmatched: ['Italian'] });
  });
});

describe('social plans: several choices, "open" exclusive, one stored column', () => {
  it('toggles, with "open" clearing the others and any other clearing "open"', () => {
    let v = toggleComfortLevel([], 'small_groups');
    v = toggleComfortLevel(v, 'one_on_one');
    expect(v).toEqual(['one_on_one', 'small_groups']);
    expect(toggleComfortLevel(v, 'open')).toEqual(['open']);
    expect(toggleComfortLevel(['open'], 'large_gatherings')).toEqual(['large_gatherings']);
    expect(toggleComfortLevel(['open'], 'open')).toEqual([]);
    expect(toggleComfortLevel(v, 'small_groups')).toEqual(['one_on_one']);
  });
  it('serializes in a fixed order and reads back; single values from older builds read as-is', () => {
    expect(serializeComfortLevels(['small_groups', 'one_on_one'])).toBe('one_on_one,small_groups');
    expect(parseComfortLevels('one_on_one,small_groups')).toEqual(['one_on_one', 'small_groups']);
    expect(parseComfortLevels('small_groups')).toEqual(['small_groups']);
    expect(parseComfortLevels('open')).toEqual(['open']);
    expect(serializeComfortLevels([])).toBeNull();
    expect(parseComfortLevels(null)).toEqual([]);
    expect(parseComfortLevels('bogus,small_groups')).toEqual(['small_groups']);
  });
  it('fits when ANY chosen range holds the feel; open / none / no feel never fit', () => {
    expect(comfortFits(1, 'one_on_one,large_gatherings')).toBe(true);
    expect(comfortFits(5, 'one_on_one,large_gatherings')).toBe(true);
    expect(comfortFits(3, 'one_on_one,large_gatherings')).toBe(false);
    expect(comfortFits(3, 'small_groups')).toBe(true); // a single value from an older build
    expect(comfortFits(3, 'open')).toBe(false);
    expect(comfortFits(null, 'small_groups')).toBe(false);
    expect(comfortFits(2, null)).toBe(false);
  });
});

describe('social plans rank Home, never filter it', () => {
  const g = (id, feel) => ({ id, title: id, group_size_feel: feel, distanceMiles: 1 });
  const ranked = (level) => buildHomeRecommendations({ gatherings: [g('big', 5), g('small', 2)], socialComfortLevel: level });
  it('one bonus however many choices match; a non-matching gathering still shows', () => {
    const r = ranked('one_on_one,small_groups');
    expect(r.map((x) => x.id)).toEqual(['small', 'big']);
    const single = ranked('small_groups');
    expect(r.find((x) => x.id === 'small').score).toBe(single.find((x) => x.id === 'small').score);
  });
  it('"open" changes nothing', () => {
    const open = ranked('open');
    const none = ranked(null);
    expect(open.map((x) => [x.id, x.score])).toEqual(none.map((x) => [x.id, x.score]));
  });
});

describe('the answer survives sign-up and can be edited later', () => {
  it('Edit Profile counts a changed choice as unsaved, and order never matters', () => {
    const base = profileFormSnapshot({ socialComfortLevels: ['one_on_one', 'small_groups'] });
    expect(isProfileFormDirty(base, profileFormSnapshot({ socialComfortLevels: ['small_groups', 'one_on_one'] }))).toBe(false);
    expect(isProfileFormDirty(base, profileFormSnapshot({ socialComfortLevels: ['open'] }))).toBe(true);
  });
  it('onboarding and Edit Profile both store through the one helper; Edit Profile loads and saves the column', () => {
    const onboarding = read('screens/OnboardingQuestionsScreen.js');
    expect(onboarding).toMatch(/social_comfort_level: serializeComfortLevels\(comfortLevels\)/);
    expect(onboarding).toMatch(/toggleComfortLevel/);
    const profile = read('screens/ProfileScreen.js');
    expect(profile).toMatch(/setSocialComfortLevels\(parseComfortLevels\(data\.social_comfort_level\)\)/);
    expect(profile).toMatch(/social_comfort_level: serializeComfortLevels\(socialComfortLevels\)/);
    expect(read('screens/CompleteProfileScreen.js')).toMatch(/social_comfort_level: onboardingAnswers\.social_comfort_level/);
  });
  it('the question no longer talks about Dating, in any language', () => {
    for (const [lang, strings] of Object.entries(ui)) {
      expect(strings.socialPlansTitle).toBeTruthy();
      expect(strings.socialPlansSubtitle).toBeTruthy();
      expect(strings.itHelpsUsSuggestThe).toBeUndefined();
    }
    expect(ui.en.socialPlansTitle).toBe('What kind of social plans do you enjoy?');
    expect(ui.en.socialPlansSubtitle).toBe('This helps Nearby suggest gatherings and activities that fit your style. You can change it anytime.');
    expect(COMFORT_LEVELS).toEqual(['one_on_one', 'small_groups', 'large_gatherings', 'open']);
  });
});
