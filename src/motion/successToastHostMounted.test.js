// D1 (visit-confirmation staging run, 2026-11-21): the business website's root (App.web.js) never mounted SuccessToastHost,
// so every showSuccessToast on the website was dropped silently (incl. "Visit confirmed"). Each root mounts the ONE host
// exactly once, inside ThemeProvider (the host reads the theme), after its navigator (so it draws above the screens).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('SuccessToastHost is mounted on every root', () => {
  for (const [file, navigator] of [['App.js', 'RootNavigator'], ['App.web.js', 'BusinessWebNavigator']]) {
    test(`${file}: one host, inside ThemeProvider, after ${navigator}`, () => {
      const src = read(file);
      expect(src).toMatch(/import \{[^}]*\bSuccessToastHost\b[^}]*\} from '\.\/src\/motion'/);
      expect(src.match(/<SuccessToastHost \/>/g) || []).toHaveLength(1);
      const host = src.indexOf('<SuccessToastHost />');
      expect(src.indexOf('<ThemeProvider>')).toBeLessThan(host);
      expect(host).toBeLessThan(src.indexOf('</ThemeProvider>'));
      expect(src.search(new RegExp(`<${navigator}\\b`))).toBeLessThan(host);
    });
  }

  test('the host shows one toast at a time: a new one replaces the current one, never stacks', () => {
    const src = read('src/motion/SuccessToast.js');
    expect(src).toMatch(/const \[toast, setToast\] = useState\(null\)/);
    expect(src).toMatch(/clearTimeout\(timer\.current\);\s*swipe\.reset\(\);\s*setToast\(next\);/);
  });

  test('the website confirm re-reads the month figures after a confirmation', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    const fn = src.slice(src.indexOf('function handleConfirmVisit('), src.indexOf('function handleCancelReservation('));
    expect(fn).toMatch(/showSuccessToast\(t\('ui\.requestDetail\.visitConfirmed'\)\)/);
    expect(fn).toMatch(/loadOfferPerformance\(selectedPartner\.id\)/);
  });
});
