import { searchBusinessTypes } from './businessTypeSearch';
import { CATEGORY_GROUPS, subcategoryOptionsFor } from '../constants/gatheringCategories';

describe('business type search', () => {
  it('"coffee" suggests Food & Drink -> Coffee first', () => {
    const r = searchBusinessTypes('Coffee');
    expect(r[0]).toMatchObject({ category: 'food_drink', subcategory: 'Coffee', pathLabel: 'Food & Drink → Coffee' });
  });
  it('every result is a real major + a tag that belongs to it', () => {
    for (const q of ['bar', 'yoga', 'dent', 'car', 'pilates', 'hotel', 'photo']) {
      for (const r of searchBusinessTypes(q, 20)) {
        expect(CATEGORY_GROUPS.some((g) => g.key === r.category)).toBe(true);
        if (r.subcategory) expect(subcategoryOptionsFor(r.category)).toContain(r.subcategory);
      }
    }
  });
  it('business-only tags are findable here (a dentist can say so)', () => {
    expect(searchBusinessTypes('dental')[0]).toMatchObject({ category: 'health_personal_care', subcategory: 'Dental' });
  });
  it('a major can be picked by name, too short or unknown text finds nothing', () => {
    expect(searchBusinessTypes('food')[0].category).toBe('food_drink');
    expect(searchBusinessTypes('c')).toEqual([]);
    expect(searchBusinessTypes('zzzzqq')).toEqual([]);
    expect(searchBusinessTypes(null)).toEqual([]);
  });
});

describe('public web signup form parity', () => {
  const fs = require('fs');
  const html = fs.readFileSync(require.resolve('../../docs/business.html'), 'utf8');
  it('its embedded taxonomy equals the app taxonomy (consumer + business-only tags)', () => {
    const m = html.match(/var APPLY_TAGS = (\{.*\});/);
    expect(m).toBeTruthy();
    const web = JSON.parse(m[1]);
    const app = {};
    CATEGORY_GROUPS.forEach((g) => { app[g.key] = [...g.tags, ...(g.businessOnlyTags ?? [])]; });
    expect(web).toEqual(app);
  });
  it('its embedded synonyms equal the app synonyms', () => {
    const { seedRows } = require('../constants/categorySynonyms');
    const m = html.match(/var APPLY_SYNONYMS = (\{.*\});/);
    expect(m).toBeTruthy();
    const app = {};
    for (const r of seedRows()) (app[r.phrase] = app[r.phrase] || []).push(r.tag);
    expect(JSON.parse(m[1])).toEqual(app);
  });
  it('sends the specific type and the server keeps it only when it is a real tag of that major', () => {
    expect(html).toContain('subcategory: selectedApplySubcategory');
    const fn = fs.readFileSync(require.resolve('../../supabase/functions/submit-business-application/index.ts'), 'utf8');
    expect(fn).toMatch(/from\('category_tag_groups'\)[\s\S]*eq\('group_key', category\)/);
    expect(fn).toContain('      subcategory,');
  });
  it('the inline script still parses', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
    scripts.forEach((code) => expect(() => new Function(code)).not.toThrow());
  });
});

describe('signup type search understands synonyms', () => {
  const { searchBusinessTypes } = require('./businessTypeSearch');
  it('"cafe" finds Coffee, "gym" finds Gyms, "happy hour" finds Happy Hour', () => {
    expect(searchBusinessTypes('cafe')[0].subcategory).toBe('Coffee');
    expect(searchBusinessTypes('gym').map((r) => r.subcategory)).toContain('Gyms');
    expect(searchBusinessTypes('happy hour').map((r) => r.subcategory)).toEqual(expect.arrayContaining(['Happy Hour', 'Bars & Lounges']));
    expect(searchBusinessTypes('coffee shop')[0].subcategory).toBe('Coffee');
  });
});

describe('web signup checklist is a faithful copy of the app checklist', () => {
  const fs = require('fs');
  const html = fs.readFileSync(require.resolve('../../docs/business.html'), 'utf8');
  const start = html.indexOf('var APPLY_ATTR_KEYS');
  const end = html.indexOf('var applyAttributes = [];');
  const web = new Function(`${html.slice(start, end)}; return { applyChoices, applyToggle, APPLY_ATTR_KEYS };`)();
  const { activityChoices, toggleActivity } = require('../constants/activityLayer');
  const { BUSINESS_ATTRIBUTE_OPTIONS } = require('../constants/businessAttributes');
  const { CATEGORY_GROUPS } = require('../constants/gatheringCategories');
  // Web rows never carry offered occasions or party types, so the app side is asked the same way; activities that only those could
  // support are not offered on web (the app's checklist hides them too, because an application cannot write them).
  const tagsOf = (key) => { const g = CATEGORY_GROUPS.find((x) => x.key === key); return [...g.tags, ...(g.businessOnlyTags ?? [])]; };
  const rows = [
    { category: 'food_drink', subcategory: 'Coffee', categories: [], attributes: [] },
    { category: 'food_drink', subcategory: 'Coffee', categories: [], attributes: ['laptop_friendly'] },
    { category: 'food_drink', subcategory: 'Restaurants', categories: [], attributes: [] },
    { category: 'food_drink', subcategory: 'Restaurants', categories: ['Breakfast'], attributes: ['date_friendly', 'quiet'] },
    { category: 'food_drink', subcategory: null, categories: [], attributes: ['dog_friendly'] },
    { category: 'food_drink', subcategory: 'Bars & Lounges', categories: [], attributes: ['group_friendly', 'pet_friendly'] },
    { category: 'business_networking', subcategory: 'Coworking', categories: [], attributes: [] },
    { category: 'activities_recreation', subcategory: 'Yoga', categories: [], attributes: [] },
    { category: 'pets', subcategory: null, categories: [], attributes: [] },
  ];
  it('offers the same attribute vocabulary, in the same order', () => {
    expect(web.APPLY_ATTR_KEYS).toEqual(BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key));
  });
  it.each(rows.map((r, i) => [i, r]))('row %#: same choices as the app for everything web can write', (_i, row) => {
    const tags = tagsOf(row.category);
    const app = activityChoices(row, tags).filter((c) => c.key !== 'small_gathering');
    const w = web.applyChoices(row, tags);
    expect(w).toEqual(app);
    w.forEach((c) => {
      expect(web.applyToggle(row, c.key, tags)).toEqual(toggleActivity(row, c.key, tags));
    });
  });
  it('step 3 chips are the app\'s attribute options, labels and icons included', () => {
    const m = html.match(/var APPLY_ATTR_OPTIONS = (\[.*\]);/);
    expect(JSON.parse(m[1])).toEqual(BUSINESS_ATTRIBUTE_OPTIONS.map((o) => [o.key, o.label, o.icon]));
  });
  it('the edge function accepts only the same vocabulary and real tags of the chosen major', () => {
    const fn = fs.readFileSync(require.resolve('../../supabase/functions/submit-business-application/index.ts'), 'utf8');
    const m = fn.match(/const VALID_ATTRIBUTES = (\[.*?\]);/);
    expect(JSON.parse(m[1])).toEqual(BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key));
    expect(fn).toMatch(/eq\('group_key', category\)\.in\('tag', wanted\)/);
    expect(html).toContain('attributes: selectedApplyCategory ? applyAttributes : []');
  });
});
