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

  test('hedged environment ranks, plain environment removes only KNOWN opposites', () => {
    const list = [{ category: 'Hiking', score: 0 }, { category: 'Movies', score: 0 }, { category: 'Something Unknown', score: 0 }];
    expect(applyAskFacets(list, parseAskFacets('tonight, preferably outside')).items).toHaveLength(3);
    expect(applyAskFacets(list, parseAskFacets('outside tonight')).items.map((c) => c.category)).toEqual(['Hiking', 'Something Unknown']);
    // sitting outside at a place is an attribute (item 102), never an environment must that removes cafés
    expect(parseAskFacets('coffee where we can sit outside').environmentRequired).toBe(false);
  });

  test('the resolver turns a preferred category into a lift, not a filter', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/isPreferredCategory\(rawText, category\)\) \{ preferredTag = category; category = null; \}/);
    expect(src).toMatch(/c\.category === preferredTag \? \{ \.\.\.c, score: \(c\.score \?\? 0\) \+ PREFERRED_CATEGORY_POINTS/);
  });
});
