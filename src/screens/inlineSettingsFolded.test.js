// Screen-reduction audit B10 (2026-10-09): Blocked users, the quick-filter editor and AI Automation open IN PLACE where
// they are reached, not on their own screens.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('the three routes and screen files are gone from both navigators', () => {
  for (const nav of ['navigation/RootNavigator.js', 'navigation/BusinessWebNavigator.js']) {
    const src = read(nav);
    for (const name of ['BlockedUsers', 'QuickFilterCustomize', 'BusinessAIAutomation']) expect(src).not.toMatch(new RegExp(`name="${name}"`));
  }
  for (const f of ['BlockedUsersScreen', 'QuickFilterCustomizeScreen', 'BusinessAIAutomationScreen']) {
    expect(fs.existsSync(path.join(__dirname, `${f}.js`))).toBe(false);
  }
});

test('Settings > Safety opens Blocked users in place', () => {
  const s = read('screens/SettingsScreen.js');
  expect(s).toMatch(/onPress=\{\(\) => setShowBlocked\(\(v\) => !v\)\}/);
  expect(s).toMatch(/\{showBlocked && <BlockedUsersSection \/>\}/);
});

test('the quick-filter editor opens inside the dating Filters sheet and the Friends filter panel, and updates the chips', () => {
  expect(read('components/FiltersModal.js')).toMatch(/\{customizing && <QuickFilterCustomizer mode="dating" onChange=\{onQuickFiltersChanged\} \/>\}/);
  expect(read('screens/DiscoveryScreen.js')).toMatch(/onQuickFiltersChanged=\{\(\{ order, visible, config \}\) => \{ setQuickFilterOrder\(order\); setQuickFilterVisible\(visible\);/);
  expect(read('screens/FriendDiscoveryScreen.js')).toMatch(/<QuickFilterCustomizer mode="friends" onChange=\{\(\{ order, visible \}\) => \{ setQuickFilterOrder\(order\); setQuickFilterVisible\(visible\); \}\} \/>/);
  expect(read('components/QuickFilterCustomizer.js')).toMatch(/onChange\?\.\(\{ order: newOrder, visible: newVisible, config: newConfig \}\)/);
});

test('AI Automation opens in place on the business dashboard', () => {
  const d = read('screens/BusinessDashboardScreen.js');
  expect(d).toMatch(/\{showAiAutomation && <BusinessAIAutomationPanel partnerId=\{selectedPartner\.id\}/);
  expect(d).not.toMatch(/navigate\('BusinessAIAutomation'/);
});

test('no screen navigates to the folded routes', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
  for (const f of walk(SRC)) {
    expect(fs.readFileSync(f, 'utf8')).not.toMatch(/navigate\('(BlockedUsers|QuickFilterCustomize|BusinessAIAutomation)'/);
  }
});
