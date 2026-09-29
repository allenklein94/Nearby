// Localization pass 5 guards: every ui namespace carries all 11 languages with the same keys and placeholders, every
// ui.* key the code reads exists, and a translated label is never saved as a value.
import fs from 'fs';
import path from 'path';
import { UI_NAMESPACES, UI_LANGUAGES } from './ui';
import { translations } from './translations';
import { translate } from './translate';

const SRC = path.join(__dirname, '..');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['__fixtures__', 'business'].includes(e.name)) walk(p, out); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = walk(SRC).map((f) => [path.relative(SRC, f), fs.readFileSync(f, 'utf8')]);

const isPlural = (v) => v && typeof v === 'object' && typeof v.other === 'string';
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out[key] = v; else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}
const placeholders = (v) => [...new Set((typeof v === 'string' ? [v] : Object.values(v)).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].filter((p) => p !== 'count').sort();

describe('ui namespaces', () => {
  for (const [ns, mod] of Object.entries(UI_NAMESPACES)) {
    test(`${ns}: every language has exactly the English keys, non-empty, same placeholders`, () => {
      const en = flatten(mod.en);
      expect(Object.keys(en).length).toBeGreaterThan(0);
      for (const lang of UI_LANGUAGES) {
        const other = flatten(mod[lang] ?? {});
        expect([ns, lang, Object.keys(other).sort()]).toEqual([ns, lang, Object.keys(en).sort()]);
        for (const [key, value] of Object.entries(other)) {
          const forms = typeof value === 'string' ? [value] : Object.values(value);
          for (const f of forms) expect([ns, lang, key, typeof f === 'string' && f.trim().length > 0]).toEqual([ns, lang, key, true]);
          expect([ns, lang, key, placeholders(value)]).toEqual([ns, lang, key, placeholders(en[key])]);
          if (isPlural(en[key])) expect([ns, lang, key, isPlural(value)]).toEqual([ns, lang, key, true]);
        }
      }
    });
  }
  test('merged into translations.<lang>.ui and read through the one lookup', () => {
    for (const lang of UI_LANGUAGES) expect(translations[lang].ui.common.cancel).toBe(UI_NAMESPACES.common[lang].cancel);
    expect(translate('de', 'ui.common.count.people', { count: 1 })).toBe('1 Person');
    expect(translate('ru', 'ui.common.count.people', { count: 3 })).toBe('3 человека');
    expect(translate('en', 'ui.common.count.people', { count: 3 })).toBe('3 people');
  });
});

describe('the code only reads keys that exist', () => {
  test('every literal ui.* key in the source is an English key', () => {
    const en = flatten(translations.en.ui);
    const missing = [];
    for (const [file, src] of SOURCES) {
      for (const m of src.matchAll(/['"`]ui\.([a-zA-Z0-9_.]+)['"`]/g)) {
        const key = m[1];
        if (!(key in en) && !Object.keys(en).some((k) => k.startsWith(`${key}.`))) missing.push(`${file}: ui.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('translated labels are never saved as values', () => {
  // A picker stores its canonical option (tag, key, value); only the text on screen is translated. These are the shapes that
  // would store or compare a translated string instead.
  const SAVE_TRANSLATED = [
    /\bset[A-Z]\w*\(\s*(t|tr|translate)\(/, // setX(t('...'))
    /\bset[A-Z]\w*\(\s*names\.\w+\(/, // setX(names.tag(...))
    /\bset[A-Z]\w*\(\s*display[A-Z]\w*\(/, // setX(displayWhen(...))
    /\.(insert|update|upsert)\(\s*\{[^}]*\b(t|tr)\(\s*['"`]ui\./, // a row written with ui text
    /_param:\s*(t|tr)\(\s*['"`]ui\./, // an RPC argument that is ui text
    /(===|!==)\s*(t|tr)\(\s*['"`]ui\./, // comparing against a translated label
  ];
  test('no source file stores, sends or compares a translated ui label', () => {
    const bad = [];
    for (const [file, src] of SOURCES) for (const re of SAVE_TRANSLATED) if (re.test(src)) bad.push(`${file}: ${re}`);
    expect(bad).toEqual([]);
  });
});
