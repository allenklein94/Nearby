// Location wiring guard: device position comes from services/userLocation.js so the app checks
// permission once, shares/caches fixes, and falls back to a stored position. Only these files may talk to
// expo-location's permission/position APIs directly, each for a stated reason.
const fs = require('fs');
const path = require('path');

const ALLOWED = {
  'services/userLocation.js': 'the central provider',
  'services/proximity.js': 'background presence needs its own foreground+background permission flow',
  'screens/OnboardingLocationScreen.js': 'the one deliberate first-run permission ask',
  'screens/SelectGatheringLocationScreen.js': 'a map picker seeded from a fresh fix the user then adjusts',
  'components/DateCheckInModal.js': 'safety check-in wants a fresh, exact fix at the moment of sharing',
  'services/intentOutcomes.js': 'passive fire-and-forget last-known read, must never prompt or wait',
  'screens/BusinessPartnerApplyScreen.js': 'passive last-known search bias, must never prompt',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

test('only allow-listed files call expo-location permission/position APIs directly', () => {
  const root = path.join(__dirname, '..');
  const bad = walk(root)
    .filter((f) => /Location\.(requestForegroundPermissionsAsync|getForegroundPermissionsAsync|getCurrentPositionAsync|getLastKnownPositionAsync)\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .filter((f) => !ALLOWED[f]);
  expect(bad).toEqual([]);
});
