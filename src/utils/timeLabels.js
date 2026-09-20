// The one home for turning a stored timestamp into text (rule 7: the screen
// never prints "Invalid Date", "NaNh ago" or a 1970 date for a missing value,
// and never says "just now" for something that was not just now).
// Every function returns null when the input is missing or not a real date,
// so callers render nothing rather than a wrong string.

export function parseDate(iso) {
  if (iso == null || iso === '') return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Fri, Aug 14, 7:15 PM"
export function formatDateTime(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "Aug 14, 2026" (withYear) or "Aug 14"
export function formatDay(iso, { withYear = false } = {}) {
  const d = parseDate(iso);
  if (!d) return null;
  return d.toLocaleDateString([], withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

// Elapsed time since `iso`: "just now" (under a minute, or a timestamp a
// little in the future from clock skew), "5m ago", "3h ago", "2d ago".
// A timestamp more than 5 minutes in the future is not "ago" at all -> null.
export function formatAgo(iso, now = Date.now()) {
  const d = parseDate(iso);
  if (!d) return null;
  const diffMs = now - d.getTime();
  if (diffMs < -5 * 60000) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// "5 PM" for the local hour of a real timestamp (never an hour taken in the
// database's timezone and shown as the reader's clock).
export function formatLocalHour(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'PM' : 'AM'}`;
}
