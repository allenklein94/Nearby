import fs from 'fs';
import path from 'path';

// Owner item 35 (2026-09-21): each top-level surface has ONE job. Home = "what should I do right now?" (a capped attention
// list, never a category directory); Discover = what exists around me (where categories live).
const read = (f) => fs.readFileSync(path.join(__dirname, '../screens', f), 'utf8');

describe('surface jobs', () => {
  it('Home does not browse categories (no category rail, no group list)', () => {
    const home = read('HomeScreen.js');
    expect(home).not.toMatch(/import \{[^}]*CATEGORY_GROUPS[^}]*\} from/);
    expect(home).not.toMatch(/railGroups|discoverCategoryRail|openCategoryContext/);
  });
  it('Discover owns the category rail', () => {
    expect(read('DiscoverHubScreen.js')).toMatch(/railGroups\(CATEGORY_GROUPS\)/);
  });
});
