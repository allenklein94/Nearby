// Item 103: must-have vs nice-to-have. The owner's example: outside + tonight are musts, live music is a preference.
import { splitHedge, isPreferredCategory } from './askPreferences';
import { parseAskFacets, applyAskFacets } from '../constants/askFacets';
import { resolveAsk } from './askResolver';
import fs from 'fs';
import path from 'path';

const EXAMPLE = 'I want somewhere outside tonight, preferably with live music.';

describe('must-have vs nice-to-have (item 103)', () => {
  test("owner's example: outdoor required, tonight kept, live music a preference", () => {
    const r = resolveAsk(EXAMPLE, null);
    expect(r.time.dateWindow).toBe('tonight');
    expect(r.subcategory).toBe('Live Music');
    expect(isPreferredCategory(EXAMPLE, 'Live Music')).toBe(true);
    const f = parseAskFacets(EXAMPLE);
    expect(f).toMatchObject({ environment: 'outdoor', environmentRequired: true });
  });

  test('a plainly named category stays a must', () => {
    expect(isPreferredCategory('live music tonight, preferably outside', 'Live Music')).toBe(false);
    expect(isPreferredCategory('live music tonight', 'Live Music')).toBe(false);
    expect(isPreferredCategory('something tonight, ideally live music, or live music tomorrow. live music please', 'Live Music')).toBe(false);
  });

  test('every hedge form, and the hedge ends at the sentence break', () => {
    for (const h of ['preferably', 'ideally', 'if possible', 'bonus if there is', 'would be nice to have', 'even better if it has']) {
      expect(isPreferredCategory(`somewhere outside tonight, ${h} live music`, 'Live Music')).toBe(true);
    }
    expect(splitHedge('drinks, ideally a patio. Outside.').rest.trim()).toBe('Outside.');
    expect(splitHedge('coffee tonight')).toBeNull();
  });

  test('"maybe" is not a hedge (undecided asks stay ordinary asks)', () => {
    expect(splitHedge("I don't know, maybe coffee")).toBeNull();
  });

  test('hedged environment ranks, plain environment keeps only the KNOWN asked side', () => {
    const list = [{ category: 'Hiking', score: 0 }, { category: 'Movies', score: 0 }, { category: 'Something Unknown', score: 0 }];
    expect(applyAskFacets(list, parseAskFacets('tonight, preferably outside')).items).toHaveLength(3);
    expect(applyAskFacets(list, parseAskFacets('outside tonight')).items.map((c) => c.category)).toEqual(['Hiking']);
    expect(applyAskFacets(list, parseAskFacets('indoors tonight')).items.map((c) => c.category)).toEqual(['Movies']);
    // sitting outside at a place is an attribute (item 102), never an environment must that removes cafés
    expect(parseAskFacets('coffee where we can sit outside').environmentRequired).toBe(false);
  });

  test('the resolver turns a preferred category into a lift, not a filter', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/isPreferredCategory\(rawText, category\)\) \{ preferredTag = category; category = null; \}/);
    expect(src).toMatch(/c\.category === preferredTag \? \{ \.\.\.c, score: \(c\.score \?\? 0\) \+ PREFERRED_CATEGORY_POINTS/);
  });
});

// Item 105 (2026-09-27): how sure the words sound decides whether an environment is a must or a preference.
describe('environment certainty', () => {
  const { parseAskFacets, applyAskFacets } = require('../constants/askFacets');
  test.each([
    ['Maybe something outdoors?', false],
    ['perhaps something outside tonight', false],
    ['something outdoors or something', false],
    ['I definitely want to be outside.', true],
    ['somewhere outside tonight', true],
    ['maybe dinner, but it has to be outside', true],
    ['Maybe coffee. Somewhere outside.', true],
    ['preferably outside', false],
  ])('%s -> required %s', (text, required) => {
    const f = parseAskFacets(text);
    expect(f.environment).toBe('outdoor');
    expect(f.environmentRequired).toBe(required);
  });

  test('a tentative outdoors keeps indoor results (lifted, not removed); a firm one removes them', () => {
    const list = [{ type: 'gathering', id: 'in', category: 'Movies', score: 1 }, { type: 'gathering', id: 'out', category: 'Hiking', score: 1 }];
    const soft = applyAskFacets(list, parseAskFacets('Maybe something outdoors?')).items;
    expect(soft.map((c) => c.id).sort()).toEqual(['in', 'out']);
    expect(soft.find((c) => c.id === 'out').score).toBeGreaterThan(soft.find((c) => c.id === 'in').score);
    const firm = applyAskFacets(list, parseAskFacets('I definitely want to be outside.')).items;
    expect(firm.map((c) => c.id)).toEqual(['out']);
  });

  test('"maybe" still does not soften a category (unchanged)', () => {
    expect(splitHedge("I don't know, maybe coffee")).toBeNull();
  });
});

describe('the "be outdoors" route follows the same certainty (item 105)', () => {
  const { openEndedAskGroups } = require('./openEndedAsk');
  test('a must limits to Outdoors; a tentative or hedged one does not', () => {
    expect(openEndedAskGroups({ rawText: 'It has to be outside' })).toEqual(['outdoors_nature']);
    expect(openEndedAskGroups({ rawText: 'somewhere outside tonight' })).toEqual(['outdoors_nature']);
    expect(openEndedAskGroups({ rawText: 'Maybe something outdoors?' })).not.toEqual(['outdoors_nature']);
    expect(openEndedAskGroups({ rawText: 'preferably outside' })).not.toEqual(['outdoors_nature']);
  });
});
