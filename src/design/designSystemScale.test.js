// Design-system consolidation D1-D8 (owner approved all eight, 2026-11-28; PRODUCT_AUDIT/DESIGN_SYSTEM_AUDIT_2026-11-27.md).
// The codemod scripts/design/consolidate-styles.py applied them once; this guard keeps them true:
//   - re-running the codemod finds nothing to change (every rule D1-D6 + D8 still holds everywhere),
//   - no text below 12 pt, and only scale sizes in named text styles,
//   - every full-width block CTA spreads the one PRIMARY_BUTTON (48 pt high, above the 44 pt touch target),
//   - the women-only badge text uses the token that passes 4.5:1.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PRIMARY_BUTTON } = require('../constants/buttonStates');
const { lightColors, darkColors, typography } = require('../theme');

const ROOT = path.join(__dirname, '..');
const files = ['screens', 'components'].flatMap((d) => fs.readdirSync(path.join(ROOT, d))
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => path.join(ROOT, d, f)));

describe('design-system scale (D1-D8)', () => {
  test('the consolidation codemod has nothing left to change', () => {
    const out = execFileSync('python3', [path.join(ROOT, '..', 'scripts', 'design', 'consolidate-styles.py')], { encoding: 'utf8' });
    expect(out.trim().split('\n').pop()).toBe('0 style objects in 0 files (dry run)');
  });

  test('no text below 12 pt anywhere in screens or components', () => {
    const small = [];
    for (const f of files) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/fontSize:\s*(\d+)\b/g)) if (Number(m[1]) < 12) small.push(`${path.basename(f)}:${m[1]}`);
    }
    expect(small).toEqual([]);
  });

  test('one primary button: 48 pt high, pill, centred; used by the block CTAs', () => {
    expect(PRIMARY_BUTTON).toEqual({ paddingVertical: 14, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' });
    const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes('...PRIMARY_BUTTON'));
    expect(users.length).toBeGreaterThanOrEqual(48);
    for (const f of ['CreateGatheringScreen.js', 'AskBusinessScreen.js', 'LoginScreen.js', 'OnboardingScreen.js', 'CelebrateSomethingScreen.js']) {
      expect(fs.readFileSync(path.join(ROOT, 'screens', f), 'utf8')).toContain('...PRIMARY_BUTTON');
    }
  });

  test('the text scale has the D1 steps', () => {
    expect([typography.subhead.fontSize, typography.secondary.fontSize, typography.label.fontSize]).toEqual([18, 15, 14]);
  });

  test('women-only badge text passes 4.5:1 in both themes (D8)', () => {
    const lum = (hex) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort(); return (y + 0.05) / (x + 0.05); };
    expect(ratio(lightColors.womenOnlyText, lightColors.background)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(darkColors.womenOnlyText, darkColors.background)).toBeGreaterThanOrEqual(4.5);
    const detail = fs.readFileSync(path.join(ROOT, 'screens', 'GatheringDetailScreen.js'), 'utf8');
    expect(detail).toMatch(/womenOnlyBadgeText:\s*\{\s*color:\s*colors\.womenOnlyText/);
  });
});
