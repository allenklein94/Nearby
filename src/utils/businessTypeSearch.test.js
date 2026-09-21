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
