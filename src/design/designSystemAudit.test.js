// Item 34 (owner, 2026-11-27): design-system guards that hold app-wide. A new screen or component that breaks one fails here.
const { execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const run = (script, ...args) => execFileSync('node', [path.join(ROOT, 'scripts/design', script), ...args], { encoding: 'utf8' });

test('every tappable control has a screen-reader role (Babel AST, not a regex)', () => {
  const r = JSON.parse(run('a11y-roles.js'));
  expect(r.added).toBe(0);
  // the only exceptions, each reviewed: ToggleRow sets role "switch" via toggleRowA11y; ScaleButton defaults to button
  // and lets a caller override; two full-screen backdrops (tap anywhere to close) stay silent.
  expect(r.skippedSpread).toBeLessThanOrEqual(2);
  expect(r.skippedBackdrop).toBeLessThanOrEqual(2);
}, 60000);

test('every control styled under 44 pt has an invisible hitSlop that reaches 44 pt', () => {
  expect(JSON.parse(run('touch-targets.js')).under44).toBe(0);
}, 60000);
