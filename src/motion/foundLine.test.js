// Idea "176" fix (2026-10-18): FoundLine has no built-in English default, so every caller passes a translated line
// (Home ui.home.foundIdeas, Discover + Celebrate ui.common.foundResults), and the key exists in all 11 languages.
import fs from 'fs';
import path from 'path';
import common from '../i18n/ui/common';
import { UI_LANGUAGES } from '../i18n/ui';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('FoundLine is always translated', () => {
  test('FoundLine carries no English default text', () => {
    const src = read('motion/FoundLine.js');
    expect(src).toMatch(/export default function FoundLine\(\{ text \}\)/);
    expect(src).not.toMatch(/text\s*=\s*["']/);
  });

  test.each([
    ['screens/HomeScreen.js', 'ui.home.foundIdeas'],
    ['screens/DiscoverHubScreen.js', 'ui.common.foundResults'],
    ['screens/CelebrateSomethingScreen.js', 'ui.common.foundResults'],
  ])('%s passes a translated line to every FoundLine', (file, key) => {
    const uses = read(file).match(/<FoundLine\b[^>]*\/>/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toContain(`text={t('${key}')}`);
  });

  test('no other screen renders FoundLine without a text prop', () => {
    const dir = path.join(__dirname, '..', 'screens');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
      for (const u of fs.readFileSync(path.join(dir, f), 'utf8').match(/<FoundLine\b[^>]*\/>/g) ?? []) {
        expect([f, /text=\{t\('ui\./.test(u)]).toEqual([f, true]);
      }
    }
  });

  test('ui.common.foundResults exists in all 11 languages, English unchanged', () => {
    expect(UI_LANGUAGES).toHaveLength(11);
    expect(common.en.foundResults).toBe("Here's what we found.");
    for (const lang of UI_LANGUAGES) expect([lang, typeof common[lang]?.foundResults === 'string' && common[lang].foundResults.length > 0]).toEqual([lang, true]);
  });
});
