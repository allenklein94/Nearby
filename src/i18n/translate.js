// The one lookup behind LanguageContext's t(): a dotted key in the current language, else English (the app's fallback
// convention), else the key itself. `vars` fills {placeholders} (reasons.askedFor + { category }); a placeholder with no
// value is left as written so a missing value is visible in tests, never silently dropped. Pure, so pure modules (the shared
// recommendation context) use the exact same lookup the screens do.
//
// Plurals: a value may be an object of plural forms ({ one, few, many, other }) instead of a string; the form is chosen from
// vars.count by the language's own rule (pluralCategory below), falling back to `other`. Only languages whose grammar needs it
// use objects (Russian's 1 / 2-4 / 5+ forms); a plain string works for every count.
import { translations } from './translations';

export const DEFAULT_LANGUAGE = 'en';

function lookup(language, parts) {
  let value = translations[language];
  for (const part of parts) value = value?.[part];
  return value;
}

// CLDR plural categories for the app's 11 languages (integers are all the app counts).
export function pluralCategory(language, n) {
  const num = Number(n);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return 'other'; // decimals ("1,2 мили") take the `other` form
  const i = Math.abs(num);
  switch (language) {
    case 'zh': case 'vi': case 'ko': return 'other';
    case 'fr': case 'ht': return i === 0 || i === 1 ? 'one' : 'other';
    case 'pt': return i === 0 || i === 1 ? 'one' : 'other';
    case 'tl': { const last = i % 10; return last === 4 || last === 6 || last === 9 ? 'other' : 'one'; }
    case 'ru': {
      const m10 = i % 10; const m100 = i % 100;
      if (m10 === 1 && m100 !== 11) return 'one';
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
      return 'many';
    }
    default: return i === 1 ? 'one' : 'other'; // en, es, de
  }
}

const isPluralObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.other === 'string';

function pick(language, value, vars) {
  if (!isPluralObject(value)) return value;
  const cat = vars && vars.count !== undefined && vars.count !== null ? pluralCategory(language, vars.count) : 'other';
  return typeof value[cat] === 'string' ? value[cat] : value.other;
}

export function interpolate(template, vars) {
  if (typeof template !== 'string' || !vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined || vars[name] === null ? m : String(vars[name])));
}

export function translate(language, keyPath, vars = null) {
  const parts = String(keyPath).split('.');
  let lang = language;
  let value = lookup(language, parts);
  if (value === undefined) { value = lookup(DEFAULT_LANGUAGE, parts); lang = DEFAULT_LANGUAGE; }
  if (value === undefined) return keyPath;
  return interpolate(pick(lang, value, vars), vars);
}

// Does this language itself carry the key (no English fallback)? Used by the coverage tests.
export function hasOwnTranslation(language, keyPath) {
  const v = lookup(language, String(keyPath).split('.'));
  return typeof v === 'string' || isPluralObject(v);
}

// Every string form of a value (a plural object's forms, or the string itself).
export function valueForms(value) {
  if (typeof value === 'string') return [value];
  if (isPluralObject(value)) return Object.values(value).filter((v) => typeof v === 'string');
  return [];
}
