import { DISCOVER_RAIL_PRIMARY, railGroups } from './discoverCategoryRail';
import { CATEGORY_GROUPS } from './gatheringCategories';

describe('Discover category rail', () => {
  it('leads with a short curated set of real groups (not a directory)', () => {
    const keys = new Set(CATEGORY_GROUPS.map((g) => g.key));
    expect(DISCOVER_RAIL_PRIMARY.length).toBeLessThanOrEqual(8);
    for (const p of DISCOVER_RAIL_PRIMARY) expect(keys.has(p.key)).toBe(true);
  });
  it('every group is reachable exactly once (primary or More)', () => {
    const { primary, more } = railGroups(CATEGORY_GROUPS);
    const all = [...primary, ...more].map((x) => x.group.key);
    expect(all.sort()).toEqual(CATEGORY_GROUPS.map((g) => g.key).sort());
    expect(new Set(all).size).toBe(all.length);
  });
  it('the long tail sits under More', () => {
    const { more } = railGroups(CATEGORY_GROUPS);
    expect(more.map((m) => m.group.key)).toEqual(expect.arrayContaining(['pets', 'home_local_services', 'auto_transportation', 'stay_getaway']));
  });
  it('Discover renders the rail from this file, not the raw 19-group list', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
    expect(src).toMatch(/railGroups\(CATEGORY_GROUPS\)/);
    expect(src).not.toMatch(/\{CATEGORY_GROUPS\.map\(\(group\) => \(\s*<TouchableOpacity\s+key=\{group\.key\}\s+style=\{styles\.categoryChip\}/);
  });
});
