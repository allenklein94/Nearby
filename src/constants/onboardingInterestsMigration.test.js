import { migrateOnboardingDraft, savedOnboardingInterests, ONBOARDING_DRAFT_VERSION } from './onboardingInterests';
import { canonicalizeInterests, sanitizeInterestGroups } from './interestGraph';

const onboardingEn = require('../i18n/ui/onboarding').default.en; // the screen's wording lives in ui.onboarding
const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
const savedFrom = (draft) => savedOnboardingInterests(migrateOnboardingDraft(draft));

describe('people partway through the OLD onboarding when this ships', () => {
  it('stage 1: only goals answered -> goals kept, nothing invented', () => {
    const m = migrateOnboardingDraft({ goals: ['Meet new people'], groupKeys: [], tags: [] });
    expect(m.goals).toEqual(['Meet new people']);
    expect(savedFrom({ goals: ['Meet new people'] })).toEqual({ tags: [], groups: [] });
  });
  it('stage 2: groups picked, no favorites yet -> every group kept as a broad interest', () => {
    const draft = { goals: [], groupKeys: ['food_drink', 'outdoors_nature'], tags: [] };
    expect(migrateOnboardingDraft(draft).earlierGroups).toEqual(['food_drink', 'outdoors_nature']);
    expect(savedFrom(draft)).toEqual({ tags: [], groups: ['food_drink', 'outdoors_nature'] });
  });
  it('stage 3: favorites picked -> every tag kept; a tag that is a whole quick pick turns that pick on', () => {
    const draft = { groupKeys: ['food_drink', 'activities_recreation'], tags: ['Coffee', 'Wine', 'Pickleball', 'Yoga'] };
    const m = migrateOnboardingDraft(draft);
    expect(m.quickKeys).toEqual(['coffee', 'yoga']);
    expect(m.earlierTags).toEqual(['Wine', 'Pickleball']);
    const saved = savedFrom(draft);
    expect(saved.tags.sort()).toEqual(['Coffee', 'Pickleball', 'Wine', 'Yoga']);
    expect(saved.groups).toEqual(['food_drink', 'activities_recreation']);
  });
  it('stage 4: past interests, on looking-for / comfort -> those answers and every interest carry over', () => {
    const draft = { goals: ['Plan celebrations'], lookingFor: 'friends', comfortLevel: 'small_groups', groupKeys: ['arts_culture_learning'], tags: ['Museums'] };
    const m = migrateOnboardingDraft(draft);
    expect(m).toMatchObject({ goals: ['Plan celebrations'], lookingFor: 'friends', comfortLevel: 'small_groups' });
    expect(savedFrom(draft)).toEqual({ tags: ['Museums'], groups: ['arts_culture_learning'] });
  });
  it('an old-flow Outdoors group is NOT turned into the Outdoors quick pick (which would add a tag they never chose)', () => {
    const m = migrateOnboardingDraft({ groupKeys: ['outdoors_nature'], tags: [] });
    expect(m.quickKeys).toEqual([]);
    expect(savedFrom({ groupKeys: ['outdoors_nature'], tags: [] }).tags).toEqual([]);
  });
  it('unknown or business-only leftovers are dropped only because they could never have been valid interests', () => {
    const m = migrateOnboardingDraft({ groupKeys: ['not_a_group', 'health_personal_care'], tags: ['Dental', 'Not A Tag', 'Coffee'] });
    expect(m.earlierGroups).toEqual([]);
    expect(m.quickKeys).toEqual(['coffee']);
    expect(m.earlierTags).toEqual([]);
  });
  it('an earlier selection is removed only when the person taps it off', () => {
    const m = { ...migrateOnboardingDraft({ groupKeys: ['pets'], tags: ['Wine'] }), earlierOff: ['Wine'] };
    expect(savedOnboardingInterests(m)).toEqual({ tags: [], groups: ['pets'] });
  });
  it('a new-format draft round-trips unchanged, including earlier selections and removed chips', () => {
    const v2 = { v: ONBOARDING_DRAFT_VERSION, goals: ['x'], lookingFor: 'both', comfortLevel: 'open', quickKeys: ['coffee'], anythingElse: 'hiking', excluded: ['Hiking'], earlierTags: ['Wine'], earlierGroups: ['pets'], earlierOff: [] };
    expect(migrateOnboardingDraft(v2)).toEqual({ goals: ['x'], lookingFor: 'both', comfortLevel: 'open', quickKeys: ['coffee'], anythingElse: 'hiking', excluded: ['Hiking'], earlierTags: ['Wine'], earlierGroups: ['pets'], earlierOff: [] });
    expect(savedOnboardingInterests(migrateOnboardingDraft(v2))).toEqual({ tags: ['Coffee', 'Wine'], groups: ['pets'] });
  });
  it('no draft / garbage draft = a clean start, never a crash', () => {
    expect(savedFrom(null)).toEqual({ tags: [], groups: [] });
    expect(savedFrom('x')).toEqual({ tags: [], groups: [] });
  });
  it('stage 5: old onboarding already completed (answers saved) -> the saved format is unchanged and still read', () => {
    // CompleteProfile reads the same two fields the old flow wrote.
    expect(canonicalizeInterests(['Coffee', 'Wine'])).toEqual(['Coffee', 'Wine']);
    expect(sanitizeInterestGroups(['food_drink'])).toEqual(['food_drink']);
    const c = read('screens/CompleteProfileScreen.js');
    expect(c).toMatch(/JSON\.parse\(pending\)\.monthly_interests/);
    expect(c).toMatch(/sanitizeInterestGroups\(onboardingAnswers\.interest_groups\)/);
  });
  it('stage 6: mid account setup -> interests already in its draft or seeded are all still shown and kept', () => {
    const c = read('screens/CompleteProfileScreen.js');
    expect(c).toMatch(/setInterests\(draft\.interests\); setKnownInterests\(draft\.interests\)/);
    expect(c).toMatch(/setInterests\(seeded\); setKnownInterests\(seeded\)/);
    expect(c).toMatch(/interestChoices = \[\.\.\.new Set\(\[\.\.\.knownInterests, \.\.\.QUICK_INTEREST_TAGS\]\)\]/);
  });
  it('the onboarding screen migrates its draft, shows earlier selections and saves through the one function', () => {
    const q = read('screens/OnboardingQuestionsScreen.js');
    expect(q).toMatch(/migrateOnboardingDraft\(JSON\.parse\(raw\)\)/);
    expect(q).toMatch(/savedOnboardingInterests\(\{ quickKeys, anythingElse, excluded, earlierTags, earlierGroups, earlierOff \}\)/);
    expect(q).toContain("t('ui.onboarding.youPickedTheseEarlierTap')");
    expect(onboardingEn.youPickedTheseEarlierTap).toContain('You picked these earlier');
    expect(q).toMatch(/v: ONBOARDING_DRAFT_VERSION/);
  });
});

describe('confirmation chips before saving', () => {
  it('removing a proposed chip keeps it out of what is saved; a quick pick is unaffected', () => {
    const state = { quickKeys: ['coffee'], anythingElse: 'cafe, hiking, board games', excluded: ['Hiking', 'Coffee'] };
    expect(savedOnboardingInterests(state).tags).toEqual(['Coffee', 'Board Games']);
  });
  it('unmatched words are never saved', () => {
    expect(savedOnboardingInterests({ anythingElse: 'zzqx, italian, dental' })).toEqual({ tags: [], groups: [] });
  });
  it('the screen explains what will be added and lists unmatched terms separately', () => {
    const q = read('screens/OnboardingQuestionsScreen.js');
    expect(q).toContain("t('ui.onboarding.theseInterestsWillBeAdded')");
    expect(onboardingEn.theseInterestsWillBeAdded).toBe('These interests will be added. Tap one to leave it out.');
    expect(q).toContain("t('ui.onboarding.notMatchedYetLine', { words: extraOnly.unmatched.join(', ') })");
    expect(onboardingEn.notMatchedYetLine).toBe('Not matched yet: {words}. You can add more interests any time from your profile.');
  });
});

describe('the full catalog stays one tap away', () => {
  it('the profile interest editor still lists every personal interest tag', () => {
    const p = read('screens/ProfileScreen.js');
    expect(p).toMatch(/PERSONAL_INTEREST_OPTIONS as INTEREST_OPTIONS/);
    expect(p).toMatch(/INTEREST_OPTIONS\.map\(\(interest\)/);
  });
});
