// Item 70 (CLAUDE.md): "Add 'What are you celebrating?' to business
// requests." Audited first: business_requests already collects occasion/
// party_size/budget_max/cuisine/attributes, and AskBusinessScreen already
// asks for all of them ("What's this for?"/"How many people?"/budget/
// Preferences) -- the one real, concrete gap was that the business's own
// pending-opportunity card (BusinessDashboardScreen.js's "What they're
// looking for" tag row) never showed the requested DATE at all, even
// though it's collected and already used internally for scoring
// (business_requests.date/time_window_start). A business deciding
// whether to respond needs to see "Sat, Sep 19" up front, same as it
// already sees occasion/party size/budget -- this closes exactly that
// gap. Pure and dependency-free so it's directly unit-testable, same
// split as occasionPackageFormatting.js.
// Exported so planAddonReadiness.js's plan-timeline formatting (Item 81,
// CLAUDE.md) can reuse the exact same "HH:MM:SS" -> "6:30 PM" logic
// instead of a second copy -- one ontology for time-of-day display, not
// two that could drift.
export function formatTimeOfDay(timeStr) {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// dateStr is a plain 'YYYY-MM-DD' (business_requests.date, no time
// component). Returns a real, honest "Sat, Sep 19" label, or null when
// no date is actually set -- never fabricated. Exported so
// planAddonReadiness.js's Item 90 plan-summary card (CLAUDE.md, "the
// Plan itself becomes the source of truth") can reuse the exact same
// date-label formatting formatRequestWhen already established below,
// instead of a second copy that could drift.
export function formatDateLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// dateStr is a plain 'YYYY-MM-DD' (business_requests.date, no time
// component); timeWindowStart/End are plain 'HH:MM:SS' time strings or
// null. Returns a real, honest label like "Sat, Sep 19" or "Sat, Sep 19,
// 6–9 PM" -- never fabricates a time window when none was actually set.
export function formatRequestWhen(dateStr, timeWindowStart = null, timeWindowEnd = null) {
  const dateLabel = formatDateLabel(dateStr);
  if (!dateLabel) return null;
  const start = timeWindowStart ? formatTimeOfDay(timeWindowStart) : null;
  if (!start) return dateLabel;
  const end = timeWindowEnd ? formatTimeOfDay(timeWindowEnd) : null;
  return end ? `${dateLabel}, ${start}–${end}` : `${dateLabel}, ${start}`;
}
