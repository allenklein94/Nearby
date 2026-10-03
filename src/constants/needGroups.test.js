// Item 161 (2026-10-03, owner): needs (services, errands, supply) vs things to do. One canonical list of need groups, and
// the four everyday need phrases that used to resolve to nothing.
import fs from 'fs';
import path from 'path';
import { CATEGORY_GROUPS, NEED_GROUP_KEYS, isNeedGroup } from './gatheringCategories';
import { NEARBY_ONTOLOGY } from './nearbyOntology';
import { openEndedAskGroups } from '../utils/openEndedAsk';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { searchScope } from './categoryTree';
import { tagsForPhrase } from './categorySynonyms';

describe('NEED_GROUP_KEYS is the one canonical need/service group list', () => {
  it('every key is a real category group, listed once', () => {
    const real = new Set(CATEGORY_GROUPS.map((g) => g.key));
    expect(NEED_GROUP_KEYS.every((k) => real.has(k))).toBe(true);
    expect(new Set(NEED_GROUP_KEYS).size).toBe(NEED_GROUP_KEYS.length);
    expect(isNeedGroup('auto_transportation')).toBe(true);
    expect(isNeedGroup('entertainment_nightlife')).toBe(false);
  });

  it('the ontology names it under the category layer (a named view, not a new layer)', () => {
    const category = NEARBY_ONTOLOGY.find((l) => l.key === 'category');
    expect(category.needs).toEqual({ file: 'constants/gatheringCategories.js', export: 'NEED_GROUP_KEYS' });
    expect(NEARBY_ONTOLOGY.some((l) => l.key === 'needs')).toBe(false);
  });

  it('the open-ended rule reads it and keeps no list of its own', () => {
    const src = fs.readFileSync(path.join(__dirname, '../utils/openEndedAsk.js'), 'utf8');
    expect(src).toMatch(/isNeedGroup\(/);
    expect(src).not.toMatch(/SUPPLY_GROUPS|'home_local_services'|'auto_transportation'/);
    // no other source file hardcodes the same list
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const copies = walk(path.join(__dirname, '..')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
      .filter((f) => /'home_local_services',\s*'auto_transportation',\s*'business_networking'/.test(fs.readFileSync(f, 'utf8')));
    expect(copies.map((f) => path.relative(path.join(__dirname, '..'), f))).toEqual(['constants/gatheringCategories.js']);
  });

  it('behavior unchanged: "something fun" = every group minus the need groups and family', () => {
    const expected = CATEGORY_GROUPS.map((g) => g.key)
      .filter((k) => !['home_local_services', 'auto_transportation', 'business_networking', 'health_personal_care', 'stay_getaway', 'pets', 'education_classes', 'family_kids'].includes(k));
    expect(openEndedAskGroups({ rawText: 'something fun tonight' })).toEqual(expected);
    expect(openEndedAskGroups({ rawText: 'something fun tonight', attributes: ['kid_friendly'] })).toContain('family_kids');
  });
});

describe('the four need phrases resolve through the normal path (synonym table -> resolveAsk / searchScope)', () => {
  it.each([
    ['I need a haircut', ['Barbers', 'Salons'], 'Barbers'],
    ['need a hair cut', ['Barbers', 'Salons'], 'Barbers'],
    ['need flowers', ['Florist'], 'Florist'],
    ['a bouquet for my wife', ['Florist'], 'Florist'],
    ['I need a gift for my mom', ['Gift Shop'], 'Gift Shop'],
    ['a birthday present', ['Gift Shop'], 'Gift Shop'],
    ['need a dog groomer', ['Grooming'], 'Grooming'],
    ['pet grooming near me', ['Grooming'], 'Grooming'],
  ])('"%s"', (text, scopeTags, category) => {
    expect(searchScope(text).tags).toEqual(scopeTags);
    expect(tagsForPhrase(text)).toEqual(scopeTags);
    expect(toClassification(resolveAsk(text, null)).category).toBe(category);
  });

  it('"last-minute reservation" stays a time/booking constraint, never a category', () => {
    expect(tagsForPhrase('need a last-minute reservation tonight')).toEqual([]);
    expect(toClassification(resolveAsk('need a last-minute reservation tonight', null)).category ?? null).toBeNull();
  });
});
