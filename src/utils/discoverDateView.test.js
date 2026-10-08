import fs from 'fs';
import path from 'path';
import { buildDiscoverDateView, buildDiscoverSections, SECTION_CAP } from './discoverSections';

// Owner item 206: "See all" on Tonight/Today or This Weekend switches Discover into a full date view in place.
const NOW = new Date(2026, 8, 25, 20, 0); // Fri 8 PM
const at = (h, dayOffset = 0) => new Date(2026, 8, 25 + dayOffset, h, 0).toISOString();
const isInWindow = (iso, key) => {
  const d = new Date(iso);
  if (key === 'today') return d.toDateString() === NOW.toDateString();
  if (key === 'weekend') return [0, 6].includes(d.getDay());
  return false;
};
const g = (id, over = {}) => ({ id, scheduled_at: at(21), interest_tag: 'Coffee', ...over });
const view = (gatherings, dateFilter) => buildDiscoverDateView({ gatherings, dateFilter, now: NOW, isInWindow });

describe('Discover date view (item 206)', () => {
  it('lists EVERY gathering in the window, not the capped section', () => {
    const many = Array.from({ length: SECTION_CAP + 6 }, (_, i) => g(`t${i}`, { scheduled_at: at(21 + (i % 2)) }));
    const v = view([...many, g('sat', { scheduled_at: at(12, 1) })], 'today');
    expect(v.items).toHaveLength(SECTION_CAP + 6);
    expect(v.items.map((x) => x.id)).not.toContain('sat');
    const sections = buildDiscoverSections({ gatherings: many, now: NOW, isInWindow });
    expect(sections.find((s) => s.key === 'tonight').items.length).toBeLessThanOrEqual(SECTION_CAP);
  });

  it('titles Tonight only when every item is a tonight start, else Today (same rule as the section)', () => {
    expect(view([g('a'), g('b')], 'today').title).toBe('🌙 Tonight');
    expect(view([g('a'), g('noon', { scheduled_at: at(13) })], 'today').title).toBe('🌅 Today');
    expect(view([g('sat', { scheduled_at: at(12, 1) })], 'weekend')).toMatchObject({ key: 'weekend', title: '🌴 This Weekend' });
  });

  it('orders by the one ladder (nearest breaks ties)', () => {
    const v = view([g('far', { distanceMiles: 5 }), g('near', { distanceMiles: 1 })], 'today');
    expect(v.items.map((x) => x.id)).toEqual(['near', 'far']);
  });

  it('is empty (never invented) when nothing fits, and refuses any other filter', () => {
    expect(view([], 'today').items).toEqual([]);
    expect(view([g('a')], 'tomorrow')).toBeNull(); // 'now' is a time chip since item 34
    expect(view([g('a')], 'anytime')).toBeNull();
  });
});

describe('Discover date view wiring (item 206 guards)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');

  it('See all on Tonight / This Weekend stays in Discover (no navigation to the Gatherings feed)', () => {
    expect(src).not.toMatch(/navigate\('Gatherings', \{ initialDateFilter: section\.dateFilter \}\)/);
    expect(src).toMatch(/onPress=\{\(\) => openDateView\(section\.dateFilter\)\}/);
  });

  it('replaces the capped sections while open (no duplicates) and hides the search controls', () => {
    expect(src).toMatch(/\) : dateViewData \? \(/);
    expect(src).toMatch(/mode === 'things' && !expandedContext && !dateViewData && \(/);
  });

  it('has an explicit back control, Android back, and restores the scroll position', () => {
    expect(src).toMatch(/onPress=\{expandedContext \? closeContext : closeDateView\}/);
    expect(src).toMatch(/hardwareBackPress', \(\) => \{\s*closeDateView\(\);/);
    expect(src).toMatch(/restoreScrollY\.current = mainScrollY\.current;/);
    expect(src).toMatch(/onContentSizeChange=\{restoreMainScroll\}/);
  });

  it('shows the active date as a removable chip that exits exactly like Back', () => {
    // Item 34: the active time chip carries the view's own title + ✕, and tapping it closes the view (selectTimeChip).
    expect(src).toMatch(/const label = active \? sectionTitle\(dateViewData\)/);
    expect(src).toMatch(/\{active \? `\$\{label\} ✕` : label\}/);
  });

  it('closing changes only the date view: query, filters and mode are untouched', () => {
    const close = src.match(/function closeDateView\(\) \{([\s\S]*?)\n  \}/)[1];
    expect(close.trim()).toBe('setDateView(null);');
  });

  it('Home "See all plans" still opens Plans (a management surface, not an inline expansion)', () => {
    const home = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
    expect(home).toMatch(/onPress=\{\(\) => navigation\.navigate\('Plans'\)\}\s*accessibilityLabel=\{t\('ui\.home\.seeAllPlansA11y'\)\}/);
  });
});

// Item 34 (owner, 2026-10-08): the time chips Happening Now · Today · This Weekend reuse this same in-place view.
describe('time chips (item 34)', () => {
  const { buildDiscoverDateView: build, TIME_CHIPS } = require('./discoverSections');
  const fs = require('fs');
  const path = require('path');
  const now = new Date(2026, 9, 10, 18, 0);
  const inMin = (id, m) => ({ id, scheduled_at: new Date(now.getTime() + m * 60000).toISOString() });
  it('three chips, and Happening Now = the next 2 hours (the Right Now window)', () => {
    expect(TIME_CHIPS).toEqual(['now', 'today', 'weekend']);
    const v = build({ gatherings: [inMin('soon', 30), inMin('edge', 119), inMin('later', 180)], dateFilter: 'now', now });
    expect(v.key).toBe('now');
    expect(v.items.map((g) => g.id).sort()).toEqual(['edge', 'soon']);
  });
  it('the screen opens the one date view (no second implementation), one chip at a time, the active chip closes it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
    const fn = src.slice(src.indexOf('function selectTimeChip'), src.indexOf('function renderTimeChips'));
    expect(fn).toMatch(/if \(dateView === f\) closeDateView\(\)/);
    expect(fn).toMatch(/else if \(dateView\) setDateView\(f\)/);
    expect(fn).toMatch(/else openDateView\(f\)/);
    expect(src).toMatch(/isAll && !isSearching && \(\s*<View style=\{\[styles\.filterRow, \{ flexDirection: 'row' \}\]\}>\{renderTimeChips\(\)\}/);
    expect((src.match(/buildDiscoverDateView\(/g) ?? []).length).toBe(1);
  });
});
