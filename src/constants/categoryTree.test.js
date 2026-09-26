import { searchScope, cuisineForSearch, cuisineFromText, categoryPath, childrenOf, CUISINE_PARENT_TAGS, CUISINE_PHRASES } from './categoryTree';
import { CATEGORY_GROUPS } from './gatheringCategories';
import { CUISINE_OPTIONS } from './businessAttributes';
import { resolveAsk } from '../utils/askResolver';

const fs = require('fs');
const path = require('path');
const ALL_TAGS = new Set(CATEGORY_GROUPS.flatMap((g) => g.tags));

describe('category tree (item 76): group -> tag -> cuisine', () => {
  it('broad: a group name searches every consumer tag in it', () => {
    const s = searchScope('Food & Drink');
    expect(s.level).toBe('group');
    expect(s.tags).toEqual(expect.arrayContaining(['Coffee', 'Restaurants', 'Bakeries', 'Bars & Lounges', 'Breweries']));
    expect(searchScope('food and drink').level).toBe('group');
    expect(searchScope('Health & Personal Care').tags).not.toContain('Dental');
  });
  it('a tag that shares a name with nothing broader stays a tag; synonyms still work', () => {
    expect(searchScope('Restaurants')).toMatchObject({ level: 'tag', tags: ['Restaurants'], path: ['Food & Drink', 'Restaurants'] });
    expect(searchScope('cafe')).toMatchObject({ level: 'tag', tags: ['Coffee'] });
    expect(searchScope('Outdoors')).toMatchObject({ level: 'tag', tags: ['Outdoors'] });
  });
  it('narrow: a cuisine searches that cuisine, never every restaurant', () => {
    for (const [w, c] of [['italian', 'italian'], ['Italian food', 'italian'], ['italian restaurant near me', 'italian'], ['sushi', 'japanese'], ['bbq', 'bbq'], ['barbecue', 'bbq'], ['korean bbq', 'korean'], ['pho', 'vietnamese'], ['seafood', 'seafood']]) {
      const s = searchScope(w);
      expect(s.level).toBe('cuisine');
      expect(s.cuisine).toBe(c);
      expect(s.tags).toEqual([]);
    }
    expect(searchScope('italian').path).toEqual(['Food & Drink', 'Restaurants', 'Italian']);
  });
  it('a cuisine adjective in another context is not food', () => {
    expect(cuisineForSearch('french class')).toBeNull();
    expect(cuisineForSearch('thai massage')).toBeNull();
    expect(searchScope('thai massage').level).toBe('tag');
    expect(cuisineForSearch('greek mythology lecture')).toBeNull();
    expect(searchScope('xyz')).toMatchObject({ level: null, tags: [] });
  });
  it('asks read a cuisine from the words (no AI needed), only next to food', () => {
    expect(cuisineFromText('italian dinner tonight with my wife')).toBe('italian');
    expect(cuisineFromText('sushi with friends')).toBe('japanese');
    expect(cuisineFromText('learn french this weekend')).toBeNull();
    expect(resolveAsk('mexican food tonight', null).cuisine).toBe('mexican');
    expect(resolveAsk('mexican food tonight', null).sources.cuisine).toBe('words');
    expect(resolveAsk('dinner tonight', null).cuisine).toBeNull();
  });
  it('children: groups -> tags, restaurant tags -> cuisines (never Other), other tags none', () => {
    expect(childrenOf({ group: 'food_drink' }).map((c) => c.tag)).toContain('Restaurants');
    const cuisines = childrenOf({ tag: 'Restaurants' }).map((c) => c.label);
    expect(cuisines).toEqual(expect.arrayContaining(['Italian', 'Mexican', 'Japanese', 'Indian', 'Thai', 'Mediterranean', 'Seafood', 'BBQ']));
    expect(cuisines).not.toContain('Other');
    expect(childrenOf({ tag: 'Coffee' })).toEqual([]);
    expect(categoryPath({ tag: 'Coffee', cuisine: 'italian' })).toEqual(['Food & Drink', 'Coffee']);
  });
  it('every cuisine phrase key and parent tag is real', () => {
    const keys = CUISINE_OPTIONS.map((o) => o.key);
    for (const k of Object.keys(CUISINE_PHRASES)) expect(keys).toContain(k);
    for (const k of keys.filter((x) => x !== 'other')) expect(CUISINE_PHRASES[k]).toBeTruthy();
    for (const t of CUISINE_PARENT_TAGS) expect(ALL_TAGS.has(t)).toBe(true);
  });
});

describe('one cuisine vocabulary everywhere', () => {
  const keys = CUISINE_OPTIONS.map((o) => o.key);
  it('the migration widens every CHECK and function to exactly the client list', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270214_cuisine_children_bbq.sql'), 'utf8');
    const list = [...sql.match(/new_list text := \$q\$(.*)\$q\$/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(list).toEqual(keys);
  });
  it('each edge function list equals the client list', () => {
    for (const f of ['create-assistant', 'business-onboarding-assistant', 'screen-business-content']) {
      const src = fs.readFileSync(path.join(__dirname, `../../supabase/functions/${f}/index.ts`), 'utf8');
      const m = src.match(/(?:VALID_CUISINES|CUISINE_OPTIONS) = \[([^\]]*)\]/);
      expect([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual(keys);
    }
  });
  it('search services go through the tree', () => {
    const rd = (f) => fs.readFileSync(path.join(__dirname, '../services', f), 'utf8');
    expect(rd('brandOffers.js')).toMatch(/searchScope\(term\)/);
    expect(rd('brandOffers.js')).toMatch(/brand_partners\.cuisine/);
  });
});
