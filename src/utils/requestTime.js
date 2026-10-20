// Optional preferred start time on a business request: a deterministic time-picker value, or a clock time the person's own
// words state (owner idea "305": `pointClockFromText`, carried by askBusinessParamsFromAsk); never inferred beyond the words.
// business_requests.time_window_start is a plain wall-clock 'HH:MM'; no end time is invented.

// The picker's Date for a stated time (minutes after midnight), today on the device's clock; null when none was stated.
export function startTimeFromMinutes(minutes, base = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return null;
  const d = new Date(base);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

export function toTimeParam(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeLabel(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
