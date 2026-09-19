// "Supply first" availability: the window a business is posting for, and the demand line shown
// before it commits. Pure so it is testable; the count itself always comes from the server
// (get_availability_demand_preview, which withholds anything under the 5-person privacy floor).

const HOUR = 60 * 60 * 1000;

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
  if (!start || !end) return 'Pick when you have space.';
  if (end <= start) return 'End time must be after the start time.';
  if (end <= now) return 'That time window has already passed.';
  return null;
}

// Keep end after start when the owner moves the start.
export function shiftEndAfterStart(newStart, end) {
  if (end && end > newStart) return end;
  return new Date(newStart.getTime() + 2 * HOUR);
}

function dayLabel(startsAt, now) {
  const d = new Date(startsAt);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'today';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'tomorrow';
  return d.toLocaleDateString([], { weekday: 'long' });
}

// null when there is no honest count to show (below the floor, or not fetched).
export function demandPreviewLine({ people, category, startsAt, now = new Date() }) {
  if (!Number.isInteger(people) || people <= 0) return null;
  const what = category ? category.toLowerCase() : 'something like this';
  return `✨ ${people} ${people === 1 ? 'person' : 'people'} nearby ${people === 1 ? 'is' : 'are'} looking for ${what} ${dayLabel(startsAt, now)}.`;
}
