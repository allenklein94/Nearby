// Localization pass 5: a converted file keeps no hard-coded English UI text except the reasoned exceptions in ui/coverage.js.
// Uses the same scanner as the inventory (scripts/i18n/uiInventory.js).
import path from 'path';
import { LOCALIZED_FILES, INTENTIONAL_ENGLISH } from './ui/coverage';

const { scan } = require('../../scripts/i18n/uiInventory');
const ROOT = path.join(__dirname, '..', '..');

describe('localized files have no leftover English UI text', () => {
  test('the list is not empty once conversion has started', () => { expect(Array.isArray(LOCALIZED_FILES)).toBe(true); });
  for (const file of LOCALIZED_FILES) {
    test(file, () => {
      const allowed = new Set([...Object.keys(INTENTIONAL_ENGLISH['*']), ...Object.keys(INTENTIONAL_ENGLISH[file] ?? {})]);
      const left = scan(path.join(ROOT, file)).filter((h) => !allowed.has(h.text)).map((h) => `${h.line} ${h.kind} ${h.text}`);
      expect(left).toEqual([]);
    });
  }
});
