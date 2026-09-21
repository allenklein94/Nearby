import { ACTIVITIES, activitiesForBusiness, activitiesFromText, activityFit } from './activityLayer';
import { CATEGORY_GROUPS } from './gatheringCategories';
import { BUSINESS_ATTRIBUTE_OPTIONS } from './businessAttributes';
import { OCCASION_OPTIONS } from './businessAttributes';

const coffee = { subcategory: 'Coffee', category: 'food_drink', attributes: [], offered_occasions: [] };

describe('activity layer (what can someone do here?)', () => {
  it('one business satisfies many intents, but only through what it declared', () => {
    expect(activitiesForBusiness(coffee)).toEqual(expect.arrayContaining(['grab_coffee', 'meet_a_friend']));
    expect(activitiesForBusiness(coffee)).not.toContain('work_remotely'); // never declared laptop_friendly
    expect(activitiesForBusiness({ ...coffee, attributes: ['laptop_friendly'] })).toContain('work_remotely');
    expect(activitiesForBusiness({ ...coffee, offered_occasions: ['first_date'] })).toContain('first_date');
    expect(activitiesForBusiness({ subcategory: 'Bakeries', attributes: [] })).toEqual(expect.arrayContaining(['breakfast', 'quick_bite']));
  });
  it('a major-only business claims no tag-based activity', () => {
    expect(activitiesForBusiness({ category: 'food_drink', attributes: [] })).toEqual([]);
  });
  it('reads the ask from the person\'s own words only', () => {
    expect(activitiesFromText('somewhere to work remotely this afternoon')).toEqual(['work_remotely']);
    expect(activitiesFromText('a first date spot')).toEqual(['first_date']);
    expect(activitiesFromText('grab a coffee with a friend')).toEqual(expect.arrayContaining(['grab_coffee']));
    expect(activitiesFromText('meet a friend')).toContain('meet_a_friend');
    expect(activitiesFromText('breakfast tomorrow')).toEqual(['breakfast']);
    expect(activitiesFromText('coffee')).toEqual([]);
    expect(activitiesFromText('')).toEqual([]);
    expect(activitiesFromText(null)).toEqual([]);
  });
  it('a fitting business gets an honest reason; a non-fitting one gets nothing (never a filter)', () => {
    const asked = activitiesFromText('work remotely');
    expect(activityFit({ ...coffee, attributes: ['laptop_friendly'] }, asked)).toEqual({ key: 'work_remotely', reason: 'Good for working remotely' });
    expect(activityFit(coffee, asked)).toBeNull();
    expect(activityFit(coffee, [])).toBeNull();
  });
  it('every tag, attribute and occasion an activity uses is real taxonomy', () => {
    const tags = new Set(CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));
    const attrs = new Set(BUSINESS_ATTRIBUTE_OPTIONS.map((a) => a.key));
    const occ = new Set(OCCASION_OPTIONS.map((o) => o.key));
    const src = require('fs').readFileSync(require('path').join(__dirname, 'activityLayer.js'), 'utf8');
    for (const m of src.matchAll(/\[('[^\]]+')\]\.includes|\[(('[^']+',? ?)+)\]\.includes/g)) {
      const items = (m[1] || m[2]).split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
      for (const i of items) expect(tags.has(i) || attrs.has(i) || occ.has(i)).toBe(true);
    }
    for (const m of src.matchAll(/occasions\.includes\('([a-z_]+)'\)/g)) expect(occ.has(m[1])).toBe(true);
    expect(ACTIVITIES.length).toBeGreaterThan(5);
  });
});

describe('activity layer is wired into ranking', () => {
  it('the resolver scores and explains an activity fit, as a bonus never a filter', () => {
    const { activityFitBonus, getBusinessAvailabilityReasons, SCORE_ACTIVITY_FIT } = require('../services/intentResolverScoring');
    const row = { ...coffee, attributes: ['laptop_friendly'] };
    expect(activityFitBonus(row, ['work_remotely'])).toBe(SCORE_ACTIVITY_FIT);
    expect(activityFitBonus(coffee, ['work_remotely'])).toBe(0);
    expect(activityFitBonus(row, [])).toBe(0);
    expect(getBusinessAvailabilityReasons(row, { askedActivities: ['work_remotely'] })).toContain('Good for working remotely');
    const src = require('fs').readFileSync(require('path').join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/activitiesFromText\(rawText\)/);
    expect(src).toMatch(/score \+= activityFitBonus\(row, askedActivities\)/);
  });
});

describe('things you can do here (owner item 38)', () => {
  const { thingsToDoHere } = require('./activityLayer');
  it('the owner example: a declared coffee shop lists what it supports, with icons', () => {
    const shop = { subcategory: 'Coffee', category: 'food_drink', categories: ['Bakeries', 'Breakfast'], attributes: ['laptop_friendly', 'dog_friendly', 'date_friendly'], offered_occasions: ['celebration'], accommodates_party_types: ['groups'] };
    const labels = thingsToDoHere(shop).map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(['Grab coffee', 'Get breakfast', 'Meet friends', 'Casual date', 'Work remotely', 'Bring your dog', 'Small gathering']));
    expect(thingsToDoHere(shop).every((a) => a.icon)).toBe(true);
  });
  it('an undeclared business lists nothing, so the section does not render', () => {
    expect(thingsToDoHere({ category: 'food_drink', attributes: [] })).toEqual([]);
    expect(thingsToDoHere(null)).toEqual([]);
  });
  it('"meet a friend" matches a business whose category is not literally about that', () => {
    expect(activityFit({ subcategory: 'Coffee', attributes: [] }, activitiesFromText('I need somewhere to meet a friend'))).toEqual({ key: 'meet_a_friend', reason: 'Good for meeting a friend' });
    expect(activitiesFromText('meet friends')).toContain('meet_a_friend');
  });
  it('the public profile renders the section from the derived list', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/BusinessProfileScreen.js'), 'utf8');
    expect(src).toMatch(/thingsToDoHere\(partner\)/);
    expect(src).toMatch(/What You Can Do Here/);
  });
});

describe('owner preview hints (structured, never owner-typed)', () => {
  const { activityHints } = require('./activityLayer');
  const shop = { subcategory: 'Coffee', category: 'food_drink', attributes: [], offered_occasions: [] };
  it('names the existing attribute that would unlock an activity', () => {
    const h = activityHints(shop).find((x) => x.key === 'work_remotely');
    expect(h.add).toMatchObject({ kind: 'attribute', key: 'laptop_friendly' });
    expect(activityHints(shop).find((x) => x.key === 'bring_dog').add.key).toBe('dog_friendly');
    expect(activityHints(shop).find((x) => x.key === 'small_gathering').add).toMatchObject({ kind: 'partyType', key: 'groups' });
  });
  it('adding the attribute makes the activity eligible and removes its hint', () => {
    const next = { ...shop, attributes: ['laptop_friendly'] };
    expect(activitiesForBusiness(next)).toContain('work_remotely');
    expect(activityHints(next).some((x) => x.key === 'work_remotely')).toBe(false);
  });
  it('a business without the attribute does not qualify, and tag-only activities have no hint', () => {
    expect(activitiesForBusiness(shop)).not.toContain('work_remotely');
    expect(activityHints(shop).some((x) => x.key === 'grab_coffee')).toBe(false);
    expect(activityHints(null)).toEqual([]);
  });
  it('every hint is real vocabulary and owners cannot type activities', () => {
    const attrs = new Set(BUSINESS_ATTRIBUTE_OPTIONS.map((a) => a.key));
    for (const h of activityHints(shop)) if (h.add.kind === 'attribute') expect(attrs.has(h.add.key)).toBe(true);
    const fs = require('fs'), path = require('path');
    const dash = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(dash).toMatch(/activityHints\(selectedPartner\)/);
    expect(dash).not.toMatch(/setBusinessActivit|activity_text|customActivit/);
  });
  it('friend and friends both route to Meet friends via activity, not the word coffee', () => {
    for (const t of ['I need somewhere to meet a friend', 'meet friends', 'see my friends']) {
      expect(activitiesFromText(t)).toContain('meet_a_friend');
      expect(activityFit(shop, activitiesFromText(t)).reason).toBe('Good for meeting a friend');
    }
  });
});
