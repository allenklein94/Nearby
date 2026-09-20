import fs from 'fs';
import path from 'path';
import { lightColors, darkColors } from '../theme';

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// Item 54: coral means "primary action / selected"; status meanings have their own tokens.
describe.each([['light', lightColors], ['dark', darkColors]])('%s semantic tokens', (_n, c) => {
  test('danger is not coral, so destructive and primary never look alike', () => {
    expect(c.danger.toLowerCase()).not.toBe(c.primary.toLowerCase());
  });
  test.each(['success', 'warning', 'info', 'danger', 'expired'])('%s exists and is readable text on surface/background', (k) => {
    expect(c[k]).toBeTruthy();
    [c.surface, c.background].forEach((bg) => expect(ratio(c[k], bg)).toBeGreaterThanOrEqual(3));
  });
});

test('error/warning/status text styles never use coral', () => {
  const dirs = ['screens', 'components'].map((d) => path.join(__dirname, '..', d));
  const bad = [];
  dirs.forEach((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => {
    fs.readFileSync(path.join(d, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\w*(historyError|almostFull|needsInfoNote|statusNeedsInfo)\w*:\s*\{[^}]*color: colors\.primary\b/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }));
  expect(bad).toEqual([]);
});
