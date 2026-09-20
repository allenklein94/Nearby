// Optional preferred start time on a business request: a deterministic time-picker value, never inferred from text.
// business_requests.time_window_start is a plain wall-clock 'HH:MM'; no end time is invented.

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
