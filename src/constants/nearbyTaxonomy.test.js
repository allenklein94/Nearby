import { describeTag, tagsForPhrase, CATEGORY_GROUPS, OCCASION_OPTIONS, BUSINESS_ATTRIBUTE_OPTIONS, INTENT_ROUTES } from './nearbyTaxonomy';
import { registerSynonyms } from './categorySynonyms';
import { registerCategoryTag } from './categoryRegistry';
import fs from 'fs';
import path from 'path';

describe('nearby canonical taxonomy', () => {
  it('describeTag joins every layer for one tag', () => {
    const d = describeTag('Coffee');
    expect(d.group).toBe('food_drink');
    expect(d.synonyms).toEqual(expect.arrayContaining(['cafe', 'coffee shop']));
    expect(d.relatedFromHobbies).toContain('Reading');
    expect(describeTag('Photography').suitedAttributes).toContain('laptop_friendly');
    expect(describeTag('Dental').businessOnly).toBe(true);
    expect(describeTag('Not A Tag')).toBeNull();
  });
  it('exposes the other layers from their single sources', () => {
    expect(CATEGORY_GROUPS.length).toBeGreaterThanOrEqual(19);
    expect(OCCASION_OPTIONS.length).toBeGreaterThan(10);
    expect(BUSINESS_ATTRIBUTE_OPTIONS.length).toBe(24);
    expect(INTENT_ROUTES.length).toBeGreaterThan(20);
  });
  it('teach once: a new tag plus its synonyms is understood by search with no other change', () => {
    expect(tagsForPhrase('padel')).toEqual([]);
    registerCategoryTag('Padel', 'activities_recreation');
    registerSynonyms([{ phrase: 'padel court', tag: 'Padel' }, { phrase: 'Padel Club', tag: 'Padel' }, { phrase: 'x', tag: 'Not A Tag' }]);
    expect(tagsForPhrase('padel')).toEqual(['Padel']);
    expect(tagsForPhrase('padel courts')).toEqual(['Padel']);
    expect(tagsForPhrase('the best padel club in town')).toContain('Padel');
    expect(describeTag('Padel').group).toBe('activities_recreation');
    expect(tagsForPhrase('x')).toEqual([]);
  });
  it('synonyms are data: hydrated on sign-in and taught by an admin without a release', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(read('../services/categoryTags.js')).toMatch(/get_category_synonyms/);
    expect(read('../services/categoryTags.js')).toMatch(/admin_add_category_synonym/);
    const mig = read('../../supabase/migrations/20270191_taxonomy_synonyms_as_data.sql');
    expect(mig).toMatch(/is_admin = true/);
    expect(mig).toMatch(/insert into category_synonyms/);
  });
});
