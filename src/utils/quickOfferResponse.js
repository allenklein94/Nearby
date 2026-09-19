// The three-tap business response: Accept -> "Standard availability" (one tap) or "Special offer" (the full offer editor),
// Offer Alternative (a different time), Decline (reason picker). The server requires a non-empty description on every
// response, so the quick paths send a fixed, factual line the owner's own tap produces -- never AI text, never invented terms.
export const STANDARD_AVAILABILITY_TEXT = 'We can accommodate this as requested.';

export function buildAlternativeText(note) {
  const n = (note ?? '').trim();
  const base = "We can't do the requested time, but we can do this time instead.";
  return n ? `${base} ${n}`.slice(0, 1000) : base;
}

// Where the "another time" picker opens: the request's own date/time when it has one (so the owner scrolls from there),
// otherwise now. Only ever a starting point -- the owner must pick a time; nothing is submitted from this default.
export function alternativePickerStart(request, now = new Date()) {
  if (request?.date) {
    const d = new Date(`${request.date}T${request.time_window_start ?? '12:00:00'}`);
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) return d;
  }
  return now;
}
