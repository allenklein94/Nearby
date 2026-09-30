import { QUICK_INTERESTS, QUICK_INTEREST_TAGS, quickPicksToTaxonomy, mapAnythingElse, onboardingInterestSelection } from './onboardingInterests';
import { INTEREST_OPTIONS } from './gatheringCategories';
import { ONBOARDING_INTEREST_GROUPS } from './interestGraph';

const onboardingEn = require('../i18n/ui/onboarding').default.en; // the screen's wording lives in ui.onboarding
const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');

describe('onboarding interests: a few picks, mapped into the taxonomy (item 94)', () => {
  it('is a short list, led by the owner\'s seven', () => {
    expect(QUICK_INTERESTS.length).toBeLessThanOrEqual(12);
    expect(QUICK_INTERESTS.slice(0, 7).map((q) => q.label)).toEqual(['Coffee', 'Fitness', 'Live Music', 'Restaurants', 'Outdoors', 'Arts', 'Sports']);
  });
  it('every pick maps to real consumer tags and real onboarding groups (no second vocabulary)', () => {
    const groups = new Set(ONBOARDING_INTEREST_GROUPS.map((g) => g.key));
    for (const q of QUICK_INTERESTS) {
      expect(q.tags.length).toBeGreaterThan(0);
      for (const t of q.tags) expect(INTEREST_OPTIONS).toContain(t);
      if (q.group) expect(groups.has(q.group)).toBe(true);
    }
  });
  it('maps picks to tags, and an area pick also to its broad group', () => {
    expect(quickPicksToTaxonomy(['coffee', 'outdoors'])).toEqual({ tags: ['Coffee', 'Outdoors'], groups: ['outdoors_nature'] });
    expect(quickPicksToTaxonomy([])).toEqual({ tags: [], groups: [] });
    expect(quickPicksToTaxonomy(['not_a_pick'])).toEqual({ tags: [], groups: [] });
  });
  it('"Anything else?" maps the person\'s words through the canonical resolver', () => {
    expect(mapAnythingElse('pickleball, hiking and board games').tags).toEqual(['Pickleball', 'Hiking', 'Board Games']);
    expect(mapAnythingElse('I love climbing').tags).toEqual(['Climbing']);
    expect(mapAnythingElse('cafe').tags).toEqual(['Coffee']); // synonym
    expect(mapAnythingElse('food & drink')).toMatchObject({ tags: [], groups: ['food_drink'] });
  });
  it('never makes a business-only tag or a cuisine a personal interest; reports it as unmatched', () => {
    expect(mapAnythingElse('dental')).toEqual({ tags: [], groups: [], unmatched: ['dental'] });
    expect(mapAnythingElse('italian')).toEqual({ tags: [], groups: [], unmatched: ['italian'] });
    expect(mapAnythingElse('zzqx').unmatched).toEqual(['zzqx']);
    expect(mapAnythingElse('')).toEqual({ tags: [], groups: [], unmatched: [] });
  });
  it('merges picks and words without duplicates', () => {
    expect(onboardingInterestSelection(['coffee'], 'cafe, yoga').tags).toEqual(['Coffee', 'Yoga']);
  });
  it('onboarding shows the short list and the optional words step, never every tag', () => {
    const q = read('screens/OnboardingQuestionsScreen.js');
    expect(q).toContain("t('ui.onboarding.whatAreYouInto')");
    expect(onboardingEn.whatAreYouInto).toBe('What are you into?');
    expect(onboardingEn.chooseAFewYouCan).toContain('Choose a few');
    expect(q).toContain("t('ui.onboarding.anythingElse')");
    expect(onboardingEn.anythingElse).toBe('Anything else?');
    expect(q).toMatch(/QUICK_INTERESTS\.map/);
    expect(q).not.toMatch(/tagsForGroups\(|INTEREST_OPTIONS\.map|ONBOARDING_INTEREST_GROUPS\.map/);
    expect(q).toMatch(/monthly_interests: savedTags/);
    expect(q).toMatch(/interest_groups: sanitizeInterestGroups\(savedGroups\)/);
  });
  it('the account step confirms what was chosen plus the short list, not the whole taxonomy', () => {
    const c = read('screens/CompleteProfileScreen.js');
    expect(c).toMatch(/interestChoices\.map/);
    expect(c).not.toMatch(/PERSONAL_INTEREST_OPTIONS|INTEREST_OPTIONS\.map/);
    expect(QUICK_INTEREST_TAGS.length).toBeLessThan(20);
  });
});
