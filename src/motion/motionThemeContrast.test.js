import { lightColors, darkColors } from '../theme';

// Item 128: motion pieces must read in BOTH appearances. Guards the color pairs the motion system
// actually draws text/glyphs with against the surfaces they sit on.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const modes = { light: lightColors, dark: darkColors };

describe.each(Object.entries(modes))('%s mode motion colors', (_name, c) => {
  test('every mode defines the tokens motion components read', () => {
    ['background', 'surface', 'surfaceElevated', 'primary', 'primaryMuted', 'textPrimary',
      'textSecondary', 'border', 'surprise', 'surpriseMuted', 'inProgress'].forEach((k) => {
      expect(c[k]).toBeTruthy();
    });
  });
  test('body text (celebration/success labels) has AA contrast on surface and background', () => {
    [c.surface, c.background].forEach((bg) => {
      expect(ratio(c.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
  test('amber in-progress / countdown tone has AA contrast', () => {
    [c.surface, c.background].forEach((bg) => {
      expect(ratio(c.inProgress, bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
  test('surprise violet has AA contrast', () => {
    [c.surface, c.background].forEach((bg) => {
      expect(ratio(c.surprise, bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
  test('skeleton/loader track stays distinguishable from its surface', () => {
    // surfaceElevated (skeleton bars) must differ visibly from surface in each mode.
    expect(ratio(c.surfaceElevated, c.surface)).toBeGreaterThan(1.03);
  });
});
