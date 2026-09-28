// The one lookup behind LanguageContext's t(): a dotted key in the current language, else English (the app's fallback
// convention), else the key itself. `vars` fills {placeholders} (reasons.askedFor + { category }); a placeholder with no
// value is left as written so a missing value is visible in tests, never silently dropped. Pure, so pure modules (the shared
// recommendation context) use the exact same lookup the screens do.
import { translations } from './translations';

export const DEFAULT_LANGUAGE = 'en';

function lookup(language, parts) {
  let value = translations[language];
  for (const part of parts) value = value?.[part];
  return value;
}

export function interpolate(template, vars) {
  if (typeof template !== 'string' || !vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined || vars[name] === null ? m : String(vars[name])));
}

export function translate(language, keyPath, vars = null) {
  const parts = String(keyPath).split('.');
  let value = lookup(language, parts);
  if (value === undefined) value = lookup(DEFAULT_LANGUAGE, parts);
  if (value === undefined) return keyPath;
  return interpolate(value, vars);
}

// Does this language itself carry the key (no English fallback)? Used by the coverage tests.
export function hasOwnTranslation(language, keyPath) {
  return typeof lookup(language, String(keyPath).split('.')) === 'string';
}
