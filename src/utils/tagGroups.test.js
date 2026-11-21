// Grouped interest/category picker (owner, 2026-11-21): one grouping rule, display only, six pickers share it.
import fs from 'fs';
import path from 'path';
import { CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { buildTagGroups, initiallyExpandedGroups, selectedInGroup, canAddTag, foldForSearch } from './tagGroups';

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('buildTagGroups', () => {
  test('every offered option appears exactly once, nothing added', () => {
    for (const options of [INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS]) {
      const shown = buildTagGroups(options).flatMap((g) => g.tags);
      expect(shown.slice().sort()).toEqual(options.slice().sort());
      expect(new Set(shown).size).toBe(shown.length);
    }
  });

  test('uses the existing groups in their order, no "other" bucket today', () => {
    const groups = buildTagGroups(INTEREST_OPTIONS);
    expect(groups.map((g) => g.key)).toEqual(CATEGORY_GROUPS.filter((g) => g.tags.length).map((g) => g.key));
  });

  test('an option outside every group is kept, never dropped', () => {
    const groups = buildTagGroups(['Coffee', 'Made Up Tag']);
    expect(groups[groups.length - 1]).toEqual(expect.objectContaining({ key: 'other', tags: ['Made Up Tag'] }));
  });

  test('Dating stays out of personal interests (the caller\'s filter is respected)', () => {
    expect(buildTagGroups(PERSONAL_INTEREST_OPTIONS).flatMap((g) => g.tags)).not.toContain('Dating');
  });

  test('search matches the shown label or the key, accent- and case-insensitive; empty groups drop', () => {
    const labels = { Coffee: 'Café' };
    const byLabel = buildTagGroups(INTEREST_OPTIONS, { query: 'cafe', labelFor: (t) => labels[t] ?? t });
    expect(byLabel.flatMap((g) => g.tags)).toContain('Coffee');
    const byKey = buildTagGroups(INTEREST_OPTIONS, { query: 'COFFEE', labelFor: () => 'x' });
    expect(byKey.flatMap((g) => g.tags)).toEqual(['Coffee']);
    expect(buildTagGroups(INTEREST_OPTIONS, { query: 'zzzz-nothing' })).toEqual([]);
    expect(foldForSearch('  Café ')).toBe('cafe');
  });
});

describe('expansion + selection', () => {
  test('groups holding a selection start open, others closed', () => {
    const open = initiallyExpandedGroups(INTEREST_OPTIONS, ['Coffee']);
    expect(open).toEqual([CATEGORY_GROUPS.find((g) => g.tags.includes('Coffee')).key]);
    expect(initiallyExpandedGroups(INTEREST_OPTIONS, [])).toEqual([]);
  });

  test('per-group selected count', () => {
    const g = buildTagGroups(INTEREST_OPTIONS).find((x) => x.tags.includes('Coffee'));
    expect(selectedInGroup(g, ['Coffee', 'Nope'])).toBe(1);
  });

  test('cap: adding stops at max, removing and single-switch always allowed', () => {
    expect(canAddTag(['a', 'b'], 'c', { max: 2 })).toBe(false);
    expect(canAddTag(['a', 'b'], 'a', { max: 2 })).toBe(true);
    expect(canAddTag(['a'], 'b', { single: true })).toBe(true);
    expect(canAddTag([], 'x')).toBe(true);
  });
});

describe('the six pickers share TagGroupPicker (no flat 256-chip lists)', () => {
  const files = ['screens/ProfileScreen.js', 'screens/CreateCommunityScreen.js', 'screens/EditCommunityScreen.js',
    'components/QuickPicksEditModal.js', 'screens/FriendDiscoveryScreen.js', 'components/BusinessAIAutomationPanel.js'];
  test.each(files)('%s', (f) => {
    const s = src(f);
    expect(s).toMatch(/<TagGroupPicker/);
    expect(s).not.toMatch(/INTEREST_OPTIONS\.map\(/);
  });

  test('no other source maps the whole tag list into chips', () => {
    const root = path.join(__dirname, '..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const offenders = walk(root).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => /INTEREST_OPTIONS\.map\(\((tag|interest|option|c)\) => \(?\s*\{?\s*(const|<)/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('Quick Picks keeps its cap of 5; community + AI rule stay single choice', () => {
    expect(src('components/QuickPicksEditModal.js')).toMatch(/max=\{MAX_PICKS\}/);
    expect(src('screens/CreateCommunityScreen.js')).toMatch(/\n\s+single\n/);
    expect(src('screens/EditCommunityScreen.js')).toMatch(/\n\s+single\n/);
    expect(src('components/BusinessAIAutomationPanel.js')).toMatch(/\n\s+single\n/);
  });
});
