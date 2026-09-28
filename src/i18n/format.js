// Localized values for the text Nearby composes (localization pass 2, 2026-09-28): numbers, distances, durations, clock times,
// dates and the "when" line. Every word comes from the existing localization system (translations.<lang>.vocab), read through
// the one lookup (i18n/translate.js); these functions only decide WHICH localized template and fill it.
//
// Each function mirrors the English formatter it stands beside and reads the SAME decision:
//   localDistance  <-> utils/formatDistance.js    (same thresholds; the unit stays MILES, the app's unit everywhere: radius
//                                                  chips, walk time, routing. Only the words and the decimal mark change.)
//   localDuration  <-> gatheringPractical.durationLabel
//   localWhen      <-> timeContext.whenLabel      (via whenParts)
//   localWindow    <-> timeWindow.timeWindowState (via timeWindowParts)
// English never goes through here: the English formatters stay exactly as they were.
import { translations } from './translations';
import { translate, DEFAULT_LANGUAGE } from './translate';
import { whenParts } from '../utils/timeContext';
import { timeWindowParts } from '../utils/timeWindow';

// A raw vocab value (arrays such as weekday names), in the language or English.
export function vocabValue(language, path) {
  const walk = (lang) => path.split('.').reduce((v, p) => v?.[p], translations[lang]?.vocab);
  return walk(language) ?? walk(DEFAULT_LANGUAGE);
}
const v = (language, key, vars) => translate(language, `vocab.${key}`, vars);

export function localNumber(n, language, decimals = null) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const text = decimals == null ? String(n) : n.toFixed(decimals);
  const mark = vocabValue(language, 'number.decimal') ?? '.';
  return mark === '.' ? text : text.replace('.', mark);
}

// Same thresholds as formatDistance (feet rounded to 50 under ~1000 ft, one decimal to 10 mi, whole miles after).
export function localDistance(miles, language) {
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) return null;
  const feet = Math.round((miles * 5280) / 50) * 50;
  if (feet < 100) return v(language, 'units.underFeet', { n: localNumber(100, language), count: 100 });
  if (feet < 1000) return v(language, 'units.feet', { n: localNumber(feet, language), count: feet });
  const value = miles >= 9.95 ? Math.round(miles) : Number(miles.toFixed(1));
  const n = miles >= 9.95 ? localNumber(value, language) : localNumber(value, language, 1);
  // a one-decimal figure ("1.0", "1.2") takes the language's fractional form, so its plural count is never a whole number
  return v(language, 'units.miles', { n, count: miles >= 9.95 ? value : 0.5 });
}

// Same rule as durationLabel: under 15 = none, under an hour in minutes, else hours to one decimal.
export function localDuration(minutes, language) {
  if (!Number.isFinite(minutes) || minutes < 15) return null;
  if (minutes < 60) return v(language, 'units.minutes', { n: localNumber(minutes, language), count: minutes });
  const h = Math.round((minutes / 60) * 10) / 10;
  return v(language, 'units.hours', { n: localNumber(h, language), count: h });
}

// A clock time from minutes after midnight. `words` lets noon/midnight read as words (a clock WINDOW the person typed);
// an event's start is always numeric, like the English formatter.
export function localClock(minutes, language, { words = false } = {}) {
  if (!Number.isFinite(minutes)) return null;
  const c = vocabValue(language, 'clock') ?? {};
  if (words && minutes === 12 * 60) return c.noon;
  if (words && (minutes === 0 || minutes === 24 * 60)) return c.midnight;
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const mm = String(m).padStart(2, '0');
  const tpl = m ? c.withMinutes : c.whole;
  if (c.style === '24') return tpl.replace('{h}', String(h24)).replace('{mm}', mm);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return tpl.replace('{h}', String(h12)).replace('{mm}', mm).replace('{period}', h24 < 12 ? c.am : c.pm);
}

// The number a clock-time sentence agrees with (Spanish "a la 1" / "a las 3"): the hour as it is read in that language.
export function clockCount(minutes, language) {
  if (!Number.isFinite(minutes)) return null;
  const h24 = Math.floor(minutes / 60) % 24;
  return vocabValue(language, 'clock.style') === '24' ? h24 : (h24 % 12 === 0 ? 12 : h24 % 12);
}

const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
export const localClockOfDate = (d, language) => localClock(minutesOf(d), language);

export function localWeekday(d, language) {
  return (vocabValue(language, 'date.weekdays') ?? [])[d.getDay()] ?? null;
}

export function localDate(d, language) {
  const tpl = vocabValue(language, 'date.pattern');
  return tpl.replace('{weekday}', localWeekday(d, language)).replace('{month}', vocabValue(language, 'date.months')[d.getMonth()]).replace('{day}', String(d.getDate()));
}

// "$12" / "$12.50" with the language's decimal mark (dollars stay dollars).
export function localMoney(amount, language) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  return `$${Number.isInteger(amount) ? localNumber(amount, language) : localNumber(amount, language, 2)}`;
}

export function localWhen(iso, now = new Date(), language = DEFAULT_LANGUAGE) {
  const p = whenParts(iso, now);
  if (!p) return null;
  if (p.form === 'now') return v(language, 'when.happeningNow');
  if (p.form === 'startsIn') return v(language, 'when.startsIn', { count: p.minutes });
  const time = localClockOfDate(p.date, language);
  const count = clockCount(minutesOf(p.date), language);
  if (p.form === 'date') return v(language, 'when.dateTime', { date: localDate(p.date, language), time, count });
  return v(language, `when.${p.form}`, { time, count });
}

const LEAD = { offer: 'validUntil', availability: 'availableUntil' };

// The localized label of timeWindowState (same phases, same nulls).
export function localWindow(win, now = new Date(), kind = 'event', language = DEFAULT_LANGUAGE) {
  const p = timeWindowParts(win, now, kind);
  switch (p.form) {
    case 'unknown': case 'over': return null;
    case 'upcoming': return localWhen(new Date(p.startMs).toISOString(), new Date(p.nowMs), language);
    case 'justStarted': return v(language, 'when.happeningNow');
    case 'overEnded': return v(language, kind === 'offer' ? 'when.expired' : 'when.ended');
    case 'endingSoon': return v(language, 'when.endsIn', { count: p.minutesLeft });
    default: {
      const end = new Date(p.endMs);
      const clockText = localClockOfDate(end, language);
      const time = p.sameDay ? clockText : v(language, 'when.dayTime', { weekday: localWeekday(end, language), time: clockText });
      const lead = p.hasStart && kind === 'event' ? 'happeningUntil' : LEAD[kind] ?? 'until';
      return v(language, `when.${lead}`, { time, count: clockCount(minutesOf(end), language) });
    }
  }
}
