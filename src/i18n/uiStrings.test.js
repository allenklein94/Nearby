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

describe('empty states', () => {
  const { EMPTY_STATES } = require('../constants/emptyStates');
  test('ui.empty English is the registry, word for word, for every consumer id it carries', () => {
    const en = UI_NAMESPACES.empty.en;
    for (const [id, copy] of Object.entries(en)) expect([id, copy]).toEqual([id, EMPTY_STATES[id]]);
  });
  test('business and admin empty states are not localized (business experience and staff tooling stay English)', () => {
    for (const id of Object.keys(UI_NAMESPACES.empty.en)) expect(/^(business_|admin_|ai_)/.test(id)).toBe(false);
  });
  test('every consumer empty state in the registry is localized', () => {
    const consumer = Object.keys(EMPTY_STATES).filter((id) => !/^(business_|admin_|ai_)/.test(id));
    expect(consumer.filter((id) => !(id in UI_NAMESPACES.empty.en))).toEqual([]);
  });
});

describe('recoverable-error copy', () => {
  const { recoverableErrorCopy } = require('../utils/recoverableError');
  const { setCurrentLanguage } = require('./translate');
  afterEach(() => setCurrentLanguage('en'));
  test('English is unchanged and every known action phrase has a sentence pair', () => {
    const net = new Error('Network request failed');
    expect(recoverableErrorCopy({ what: 'send your request', error: net, draftKept: true })).toEqual({ title: "We couldn't send your request right now.", message: 'Check your connection. Your draft is saved.', canRetry: true });
    expect(recoverableErrorCopy({ what: 'do a new thing', error: { status: 500 } }).title).toBe("We couldn't do a new thing right now.");
    for (const [slug, pair] of Object.entries(UI_NAMESPACES.shared.en.errors.what)) {
      const what = slug.replace(/_/g, ' ');
      expect(pair.service).toBe(`We couldn't ${what} right now.`);
      expect(pair.input).toBe(`We couldn't ${what}. Please check it and try again.`);
    }
  });
  test('another language reads its own sentence', () => {
    setCurrentLanguage('de');
    expect(recoverableErrorCopy({ what: 'send your request', error: { status: 503 } }).title).toBe('Deine Anfrage konnte gerade nicht gesendet werden.');
  });
});

describe('action labels', () => {
  const { gatheringPrimaryAction, consumerOfferAction, opportunityPrimaryAction } = require('../utils/primaryAction');
  const { interestedConfirmation, replySentConfirmation } = require('../utils/actionConfirmations');
  const { setCurrentLanguage } = require('./translate');
  afterEach(() => setCurrentLanguage('en'));
  const g = { id: 'g1', host_id: 'h', scheduled_at: new Date(Date.now() + 86400000).toISOString(), is_public: true, capacity: null, attendees: [] };
  test('English wording is unchanged (locked copy)', () => {
    expect(gatheringPrimaryAction(g, 'me', Date.now()).label).toBe('Join');
    expect(consumerOfferAction({ status: 'accepted' }, { request: { status: 'fulfilled' } }).status).toBe("You're booked");
    expect(interestedConfirmation(true)[0]).toBe('Saved to Interested');
  });
  test('consumer labels follow the language, business labels stay English', () => {
    setCurrentLanguage('de');
    expect(gatheringPrimaryAction(g, 'me', Date.now()).label).toBe('Mitmachen');
    expect(consumerOfferAction({ status: 'accepted' }, { request: { status: 'fulfilled' } }).status).toBe('Du hast gebucht');
    expect(interestedConfirmation(false)[0]).toBe('Aus „Interessiert“ entfernt');
    expect(opportunityPrimaryAction({ status: 'pending', business_requests: { status: 'open' } }).label).toBe('Accept & Offer');
    expect(replySentConfirmation({ offer_type: 'alt_time' })[0]).toBe('New time suggested');
  });
});
