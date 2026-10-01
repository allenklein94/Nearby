// Numbers, money, clock times, dates and counts inside the business dashboard's helper sentences (business dashboard
// localization phase 6). English calls the existing English formatters, so every English line stays byte-identical; other
// languages use the shared localized formatters (i18n/format.js, i18n/display.js). Display only: never stored or compared.
import { getCurrentLanguage } from './translate';
import { localClock, localDate, localMoney, localNumber, localWindow } from './format';
import { displayCount } from './display';
import { formatTimeOfDay, formatDateLabel } from '../utils/businessRequestWhen';
import { countLabel } from '../utils/plural';
import { windowPhrase } from '../utils/timeWindow';

export const bizLanguage = () => getCurrentLanguage();
export const bizIsEnglish = () => { const l = getCurrentLanguage(); return !l || l === 'en'; };

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// "$20.00" (always two decimals, the billing style).
export function bizMoney2(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return bizIsEnglish() ? `$${Number(n).toFixed(2)}` : `$${localNumber(Number(n), bizLanguage(), 2)}`;
}

// "$45" / "$12.50" (whole dollars plain).
export function bizMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (bizIsEnglish()) return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
  return localMoney(v, bizLanguage());
}

// Plain number with the language's decimal mark.
export function bizNumber(n) {
  return bizIsEnglish() ? String(n) : localNumber(Number(n), bizLanguage()) ?? String(n);
}

// 'HH:MM[:SS]' -> "6:30 PM" / "18:30".
export function bizClock(hhmm) {
  if (bizIsEnglish()) return formatTimeOfDay(String(hhmm));
  const m = toMinutes(hhmm);
  return m == null ? null : localClock(m, bizLanguage());
}

// "7–8 PM" / "11 AM–1 PM" in English (shared AM/PM folded), "19–20" style elsewhere.
export function bizTimeRange(startHHMM, endHHMM) {
  const a = bizClock(startHHMM);
  const b = endHHMM ? bizClock(endHHMM) : null;
  if (!a) return null;
  if (!b) return a;
  if (bizIsEnglish()) return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  return `${a}–${b}`;
}

// 'YYYY-MM-DD' -> "Sat, Sep 19".
export function bizDate(dateStr) {
  if (bizIsEnglish()) return formatDateLabel(dateStr);
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : localDate(d, bizLanguage());
}

// "3 gatherings" with the language's plural form; null for an unknown count (like countLabel).
export function bizCount(n, noun, enSingular, enPlural) {
  return bizIsEnglish() ? countLabel(n, enSingular, enPlural) : displayCount(n, noun, bizLanguage());
}

// The time-window engine's label ("Available until 9 PM") in the current language; null once over/unreadable.
export function bizWindowPhrase(start, end, kind = 'availability', now = new Date()) {
  if (bizIsEnglish()) return windowPhrase(start, end, kind, now);
  return localWindow({ start, end }, now, kind, bizLanguage());
}
