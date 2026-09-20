// One date for a whole experience night (migration 20270133). Owner-picked through a deterministic picker, never inferred.
// The server stores noon UTC of the calendar date in plans.scheduled_at, so the day reads the same in every timezone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The picker returns a local Date; the calendar date the person saw is its LOCAL Y-M-D.
export function localDateParam(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 'YYYY-MM-DD' of the night, from plan.scheduled_at (owner side); null when unset or not a real date.
export function nightDateFromScheduledAt(scheduledAt) {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// A local Date at midday for a 'YYYY-MM-DD' (safe against timezone day-shift), or null.
export function nightDateToLocal(dateStr) {
  if (!DATE_RE.test(dateStr || '')) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function nightDateLabel(dateStr) {
  const d = nightDateToLocal(dateStr);
  return d ? d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : null;
}

// True when the date is today or later (local).
export function isUpcomingNightDate(dateStr, now = new Date()) {
  return !!nightDateToLocal(dateStr) && dateStr >= localDateParam(now);
}

// What a stop's request screen starts from. Null (no prefill) with no date or a date that has passed; the person can always
// change it on the stop, and nothing is sent until they submit.
export function stopDatePrefill(dateStr, now = new Date()) {
  if (!isUpcomingNightDate(dateStr, now)) return {};
  return { prefillDateWindow: 'pick_date', prefillPickedDateISO: `${dateStr}T12:00:00.000Z` };
}
