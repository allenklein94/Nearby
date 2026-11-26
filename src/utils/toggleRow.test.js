// Whole-row on/off toggles (owner, 2026-11-21): one ToggleRow, the row toggles once, the switch only shows the state.
import fs from 'fs';
import path from 'path';
import { toggleRowA11y } from './toggleRow';

const root = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const sources = walk(root).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

test('announced as a switch with its on/off state', () => {
  expect(toggleRowA11y({ on: true, label: 'Dark mode' })).toEqual({
    accessible: true, accessibilityRole: 'switch', accessibilityState: { checked: true, disabled: false }, accessibilityLabel: 'Dark mode',
  });
  expect(toggleRowA11y({ on: false, disabled: true, label: 'x', hint: 'h' }).accessibilityState).toEqual({ checked: false, disabled: true });
  expect(toggleRowA11y({ on: false, label: 'x', hint: 'h' }).accessibilityHint).toBe('h');
});

test('the switch inside the row takes no touches and is hidden from screen readers (no double toggle)', () => {
  const s = fs.readFileSync(path.join(root, 'components/ToggleRow.js'), 'utf8');
  expect(s).toMatch(/<View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>\s*<Switch/);
  expect(s).not.toMatch(/<Switch[^>]*onValueChange/);
  expect(s).toMatch(/onPress=\{\(\) => \{ if \(!disabled\) onValueChange\?\.\(!on\); \}\}/);
});

// The only bare Switches left, each because its row holds something a whole-row tap would collide with or make risky.
const ALLOWED_BARE_SWITCHES = {
  'components/ToggleRow.js': 'the display-only switch inside the row',
  'screens/BusinessDashboardScreen.js': 'a live offer\'s on/off: a stray tap on the offer details must not switch it off',
  'screens/SettingsScreen.js': 'sponsored places row holds the "Reset hidden sponsors" link',
  'screens/FriendDiscoveryScreen.js': 'the small header toggle that turns Friends off',
  'components/QuickFilterCustomizer.js': 'each row holds move-up / move-down buttons',
};

test('every other on/off control is a ToggleRow', () => {
  const counts = {};
  for (const f of sources) {
    const n = (fs.readFileSync(f, 'utf8').match(/<Switch\b/g) ?? []).length;
    if (n) counts[path.relative(root, f)] = n;
  }
  expect(Object.keys(counts).sort()).toEqual(Object.keys(ALLOWED_BARE_SWITCHES).sort());
  for (const [f, n] of Object.entries(counts)) expect([f, n]).toEqual([f, 1]);
});

// 25 = main's 24 + Settings' crossed-paths switch (trust branch), converted when main was merged into staging (2026-11-22).
test('25 rows use ToggleRow', () => {
  const n = sources.reduce((acc, f) => acc + (fs.readFileSync(f, 'utf8').match(/<ToggleRow\b/g) ?? []).length, 0);
  expect(n).toBe(25);
});
