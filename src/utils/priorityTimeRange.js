// Owner item 56 follow-up (2026-09-25): a business's optional, ADDITIVE exact time-of-day preference ("4-7 PM"),
// supplementing (never replacing) the coarse priority_time_windows buckets (morning/afternoon/evening/weekend/
// weekday/last_minute/large_group). This is a preference for the KIND of opportunity to rank higher -- never an
// availability/hours promise (that stays the separate availability-posting system). Same-day time-of-day only, no
// date, no overnight wrap, no timezone beyond the business's own device-local picker (matching every other
// business time-of-day field in this app, e.g. `available_from`/`available_until`).
//
// LOCKED boundary (owner item 58, 2026-09-25): this field is a MATCHING SIGNAL ONLY, scored against a request a
// business already received (businessOpportunityScoring.js). It must NEVER be read by a consumer-facing
// discovery/resolver surface to conjure browsable supply out of nothing -- a business that wants to be actually
// discoverable at a given time uses Post Availability / Occasion Packages / Signature Experiences instead. Guarded
// by priorityTimeBoundaryGuard.test.js; do not import this module from src/services/intentResolver*.js or any
// other consumer candidate-discovery file.
import { formatTimeOfDay } from './businessRequestWhen';

// Picker Dates -> 'HH:MM' strings, or a validation error. Both-or-neither; end must be strictly after start.
export function priorityTimeRangeFromChoice(from, to) {
  if (!from && !to) return { start: null, end: null };
  if (!from || !to) return { error: 'Set both a start and an end time, or clear both.' };
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const start = hhmm(from);
  const end = hhmm(to);
  if (end <= start) return { error: 'The end time must be after the start time.' };
  return { start, end };
}

// "4-7 PM" (or "4:30-7 PM" when either side isn't on the hour); null when there's no complete window.
export function priorityTimeRangeLabel(start, end) {
  if (!start || !end) return null;
  const a = formatTimeOfDay(start);
  const b = formatTimeOfDay(end);
  if (!a || !b) return null;
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

// Stored 'HH:MM[:SS]' -> a today-dated Date for the time picker; null for anything unparseable/absent.
export function priorityTimeStringToDate(timeStr) {
  if (!timeStr) return null;
  const [h, m] = String(timeStr).split(':').map((n) => parseInt(n, 10));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// Minutes since midnight from an 'HH:MM[:SS]' string; null for anything unparseable.
function minutesOfDay(timeStr) {
  const m = typeof timeStr === 'string' && timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Whether a request's own time-of-day (e.g. business_requests.time_window_start) falls inside the business's
// declared exact preference window. Inclusive both ends ("between 4 and 7 PM" naturally includes exactly 7).
// null whenever either side is missing/unparseable -- never a fabricated match.
export function isWithinPriorityTimeRange(timeStr, start, end) {
  if (!start || !end) return false;
  const t = minutesOfDay(timeStr);
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (t == null || s == null || e == null) return false;
  return t >= s && t <= e;
}
