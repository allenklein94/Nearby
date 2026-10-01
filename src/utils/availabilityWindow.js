// "Supply first" availability: the window a business is posting for, and the demand line shown
// before it commits. Pure so it is testable; the count itself always comes from the server
// (get_availability_demand_preview, which withholds anything under the 5-person privacy floor).

import { tr } from '../i18n/translate';
import { bizIsEnglish, bizLanguage } from '../i18n/bizFormat';
import { categoryName } from '../i18n/categoryNames';

const HOUR = 60 * 60 * 1000;
const W = (key, vars) => tr(`ui.bizHelp.availability.${key}`, vars);

// Next full hour, two hours long: a sensible starting point for the pickers (never submitted unseen).
export function defaultScheduledWindow(now = new Date()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setTime(start.getTime() + HOUR);
  return { start, end: new Date(start.getTime() + 2 * HOUR) };
}

// mode 'now': now .. now + durationHours (null = rest of today, matching the edge function).
// mode 'scheduled': the picked start/end.
export function resolveAvailabilityWindow({ mode, start, end, durationHours, now = new Date() }) {
  if (mode === 'scheduled') {
    if (!start || !end) return null;
    return { startsAt: new Date(start), endsAt: new Date(end) };
  }
  const startsAt = new Date(now);
  const endsAt = durationHours != null
    ? new Date(startsAt.getTime() + durationHours * HOUR)
    : new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate(), 23, 59, 59));
  return { startsAt, endsAt };
}

export function scheduledWindowProblem({ start, end, now = new Date() }) {
  if (!start || !end) return W('pickWhen');
  if (end <= start) return W('endAfterStart');
  if (end <= now) return W('passed');
  return null;
}

// Keep end after start when the owner moves the start.
export function shiftEndAfterStart(newStart, end) {
  if (end && end > newStart) return end;
  return new Date(newStart.getTime() + 2 * HOUR);
}

// 'today' | 'tomorrow' | the weekday (English: the device's own weekday name, as before).
function dayPart(startsAt, now) {
  const d = new Date(startsAt);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return { day: 'today' };
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, tomorrow)) return { day: 'tomorrow' };
  return { day: 'weekday', weekday: bizIsEnglish() ? d.toLocaleDateString([], { weekday: 'long' }) : tr(`ui.bizHelp.hours.day.${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]}`) };
}

// null when there is no honest count to show (below the floor, or not fetched).
export function demandPreviewLine({ people, category, startsAt, now = new Date() }) {
  if (!Number.isInteger(people) || people <= 0) return null;
  const p = dayPart(startsAt, now);
  const what = category ? (bizIsEnglish() ? category.toLowerCase() : categoryName(category, bizLanguage())) : W('somethingLikeThis');
  const vars = { count: people, what, weekday: p.weekday };
  return W(`preview.${p.day}`, vars);
}
