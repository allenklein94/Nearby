// Owner item 36 (2026-10-11): weather as a subtle contextual layer. The Home weather card gets a quiet wash and a condition
// icon; the wash fades in once when the weather changes; nothing else on screen changes.
const fs = require('fs');
const path = require('path');
const { weatherShiftShouldPlay, loadWeatherShiftSeen, peekWeatherShiftSeen, rememberWeatherShift, resetWeatherShiftSeen, WEATHER_SHIFT_KEY } = require('../utils/weatherShiftSeen');
const { WEATHER_ATMOSPHERE, weatherAtmosphere } = require('../constants/weatherAtmosphere');
const { WEATHER_HEADLINES } = require('../constants/weatherRelevance');
const { SEQUENCES, settleMs, isWithinBudget } = require('./motionBudget');
const { lightColors, darkColors } = require('../theme');

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');

describe('when the shift plays: only when the weather changes for this person', () => {
  const today = '2026-10-11';
  test('a condition not seen today plays; the same condition again does not', () => {
    expect(weatherShiftShouldPlay({ stored: null, kind: 'wet', todayKey: today })).toBe(true);
    expect(weatherShiftShouldPlay({ stored: { day: today, kind: 'wet' }, kind: 'wet', todayKey: today })).toBe(false);
  });
  test('rain turning into a perfect evening plays; a new day plays once more', () => {
    expect(weatherShiftShouldPlay({ stored: { day: today, kind: 'wet' }, kind: 'outdoor_window', todayKey: today })).toBe(true);
    expect(weatherShiftShouldPlay({ stored: { day: '2026-10-10', kind: 'wet' }, kind: 'wet', todayKey: today })).toBe(true);
  });
  test('record not read yet, or no condition = never plays (no flash, no guess)', () => {
    expect(weatherShiftShouldPlay({ stored: undefined, kind: 'wet', todayKey: today })).toBe(false);
    expect(weatherShiftShouldPlay({ stored: null, kind: null, todayKey: today })).toBe(false);
  });
  test('the record survives a restart (stored) and a failed read means nothing stored', async () => {
    const mem = {};
    const storage = { getItem: async (k) => mem[k] ?? null, setItem: async (k, v) => { mem[k] = v; } };
    resetWeatherShiftSeen(undefined);
    rememberWeatherShift('storm', '2026-10-11', storage);
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(mem[WEATHER_SHIFT_KEY])).toEqual({ day: '2026-10-11', kind: 'storm' });
    resetWeatherShiftSeen(undefined);
    await loadWeatherShiftSeen(storage);
    expect(peekWeatherShiftSeen()).toEqual({ day: '2026-10-11', kind: 'storm' });
    await loadWeatherShiftSeen({ getItem: async () => { throw new Error('x'); } });
    expect(peekWeatherShiftSeen()).toBeNull();
  });
});

describe('atmosphere: one wash + icon per condition the card can show', () => {
  test('every weather card condition has an atmosphere, and only three washes exist', () => {
    for (const kind of Object.keys(WEATHER_HEADLINES)) expect(weatherAtmosphere(kind)).toBeTruthy();
    expect(new Set(Object.values(WEATHER_ATMOSPHERE).map((a) => a.wash)).size).toBe(3);
    expect(weatherAtmosphere('unknown')).toBeNull();
  });

  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  test.each([['light', lightColors], ['dark', darkColors]])('%s: the card text keeps AA on every wash; the wash stays subtle', (_m, c) => {
    for (const { wash, tone } of Object.values(WEATHER_ATMOSPHERE)) {
      const bg = c[wash];
      expect(bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(ratio(c.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c[tone], bg)).toBeGreaterThanOrEqual(3); // the condition icon
      expect(ratio(bg, c.surface)).toBeLessThan(1.25); // a shift, not a new colour block
    }
  });
});

describe('the motion: one slow fade, decoration only, never the whole app', () => {
  const src = read('motion/WeatherShift.js');
  test('within its declared tier', () => {
    expect(isWithinBudget(settleMs('weatherShift'), SEQUENCES.weatherShift.tier)).toBe(true);
  });
  test('opacity only, native driver, no loop, takes no touches, Reduce Motion settles, only while in front', () => {
    expect(src).toMatch(/useNativeDriver: true/);
    expect(src).not.toMatch(/Animated\.loop|useNativeDriver: false|translate|scale/);
    expect(src).toMatch(/pointerEvents="none"/);
    expect(src).toMatch(/if \(reduceMotion\) \{ wash\.setValue\(1\)/);
    expect(src).toMatch(/useIsFocused/);
    expect(src).not.toMatch(/from '\.\/haptics'|Haptics\./);
  });
  test('used only by the Home weather card; the card text is never wrapped in the animation', () => {
    const users = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.js$/.test(f.name) && !/\.test\.js$/.test(f.name) && /from '\.\.\/motion\/WeatherShift'/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(SRC, p));
      }
    };
    walk(SRC);
    expect(users).toEqual(['screens/HomeScreen.js']);
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/<WeatherShift kind=\{card\.kind\}[^>]*\/>/); // self-closing: wraps nothing
  });
});
