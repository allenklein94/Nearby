// Language-aware display wrappers for screens (localization pass 5). English goes through the app's existing English
// formatters unchanged (byte-identical); every other language through i18n/format.js (same decisions, localized words).
// Display only: nothing here is ever stored or compared.
import { DEFAULT_LANGUAGE, translate } from './translate';
import { whenLabel, formatHeroDateTime } from '../utils/timeContext';
import { formatDistance, formatDistanceAway } from '../utils/formatDistance';
import { formatDay, formatDateTime, formatAgo, parseDate, formatLocalHour } from '../utils/timeLabels';
import { localWhen, localDistance, localDate, localClockOfDate, vocabValue, localMoney } from './format';

const isEnglish = (language) => !language || language === DEFAULT_LANGUAGE;
const c = (language, key, vars) => translate(language, `ui.common.${key}`, vars);

// "Today · 6:30 PM" / "Heute · 18:30"
export function displayWhen(iso, language, now = new Date()) {
  return isEnglish(language) ? whenLabel(iso, now) : localWhen(iso, now, language);
}
export function displayHeroWhen(iso, language, now = new Date()) {
  return isEnglish(language) ? formatHeroDateTime(iso, now) : (localWhen(iso, now, language) ?? '');
}
// "1.2 mi" (miles everywhere; words and decimal mark localized)
export function displayDistance(miles, language) {
  return isEnglish(language) ? formatDistance(miles) : localDistance(miles, language);
}
export function displayDistanceAway(miles, language) {
  if (isEnglish(language)) return formatDistanceAway(miles);
  const d = localDistance(miles, language);
  return d == null ? null : translate(language, 'reasons.distanceAway', { distance: d });
}
// "Aug 14" / "Aug 14, 2026"
export function displayDay(iso, language, { withYear = false } = {}) {
  if (isEnglish(language)) return formatDay(iso, { withYear });
  const d = parseDate(iso);
  if (!d) return null;
  const month = vocabValue(language, 'date.months')[d.getMonth()];
  return c(language, withYear ? 'monthDayYear' : 'monthDay', { month, day: d.getDate(), year: d.getFullYear() });
}
// "Fri, Aug 14" (weekday + date)
export function displayWeekdayDate(iso, language) {
  const d = parseDate(iso);
  if (!d) return null;
  if (isEnglish(language)) return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return localDate(d, language);
}
// "Fri, Aug 14, 7:15 PM"
export function displayDateTime(iso, language) {
  if (isEnglish(language)) return formatDateTime(iso);
  const d = parseDate(iso);
  if (!d) return null;
  return c(language, 'dateTime', { date: localDate(d, language), time: localClockOfDate(d, language) });
}
// "7:15 PM" / "19:15"
export function displayClock(iso, language) {
  const d = parseDate(iso);
  if (!d) return null;
  if (isEnglish(language)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return localClockOfDate(d, language);
}
export function displayHour(iso, language) {
  if (isEnglish(language)) return formatLocalHour(iso);
  const d = parseDate(iso);
  if (!d) return null;
  const whole = new Date(d); whole.setMinutes(0);
  return localClockOfDate(whole, language);
}
// "5m ago" / "vor 5 Min."
export function displayAgo(iso, language, now = Date.now()) {
  if (isEnglish(language)) return formatAgo(iso, now);
  const d = parseDate(iso);
  if (!d) return null;
  const diffMs = now - d.getTime();
  if (diffMs < -5 * 60000) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return c(language, 'agoJustNow');
  if (mins < 60) return c(language, 'agoMinutes', { n: mins, count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return c(language, 'agoHours', { n: hours, count: hours });
  const days = Math.floor(hours / 24);
  return c(language, 'agoDays', { n: days, count: days });
}
// "$12" / "12,50 $"-free: dollars stay dollars, decimal mark localized
export function displayMoney(amount, language) {
  if (isEnglish(language)) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
  }
  return localMoney(amount, language);
}
// "3 people" with the language's plural form (ui.common.count.<noun>); a non-number returns null like countLabel.
export function displayCount(n, noun, language) {
  const num = Number(n);
  if (n == null || n === '' || !Number.isFinite(num)) return null;
  return translate(language, `ui.common.count.${noun}`, { count: num });
}
