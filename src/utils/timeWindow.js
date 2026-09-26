// The ONE temporal engine (owner item 41). Everything that happens over time is a window with a start, an end, or both:
//   gathering / activity session  start (+ duration or end)     -> "Happening now · until 8 PM", "Ends in 20 min"
//   offer validity                end only (valid_until)        -> "Valid until 7 PM", "Ends in 20 min", "Expired"
//   availability posting          start + end                   -> "Available until 9 PM"
// One function decides the phase and the wording, so a card, a detail screen and a push cannot disagree. Nothing is invented:
// a window with neither an end nor a duration never claims it is still going beyond the shared 30-minute "just started" rule
// (timeContext.whenLabel), and an unparseable time gives phase 'unknown' and no label.
//
// Business opening hours (owner-declared since item 71, 2026-09-26) are a RECURRING weekly window in the business's timezone,
// evaluated by utils/operatingStatus.js, which also reads gatherings' live phase from this engine. Google Places' own openNow
// flag stays that provider's field and is read there too.
import { whenLabel } from './timeContext';

export const ENDING_SOON_MIN = 30;
const JUST_STARTED_MIN = 30;
const VERB = { event: 'Until', offer: 'Valid until', availability: 'Available until' };

function toMs(v) {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/^(\d{1,2}):00(\s?[AP]M)$/i, '$1$2');
}

// The window's end in ms: an explicit end wins, else start + a real duration, else null.
export function windowEnd({ start, end, durationMinutes } = {}) {
  const e = toMs(end);
  if (e != null) return e;
  const s = toMs(start);
  return s != null && Number.isFinite(durationMinutes) && durationMinutes >= 15 ? s + durationMinutes * 60000 : null;
}

// phase: 'unknown' | 'upcoming' | 'live' | 'ending_soon' | 'over'.  kind: 'event' | 'offer' | 'availability'.
export function timeWindowState(win, now = new Date(), kind = 'event') {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const s = toMs(win?.start);
  const e = windowEnd(win ?? {});
  if (s == null && e == null) return { phase: 'unknown', label: null, minutesLeft: null };

  if (s != null && s > nowMs) return { phase: 'upcoming', label: whenLabel(new Date(s).toISOString(), new Date(nowMs)), minutesLeft: null };

  if (e == null) {
    // Start only: the shared "just started" rule; never claims it is still going after that.
    return nowMs - s <= JUST_STARTED_MIN * 60000
      ? { phase: 'live', label: 'Happening now', minutesLeft: null }
      : { phase: 'over', label: null, minutesLeft: null };
  }
  if (e <= nowMs) return { phase: 'over', label: kind === 'offer' ? 'Expired' : 'Ended', minutesLeft: 0 };

  const minutesLeft = Math.ceil((e - nowMs) / 60000);
  if (minutesLeft <= ENDING_SOON_MIN) return { phase: 'ending_soon', label: `Ends in ${minutesLeft} min`, minutesLeft };
  const sameDay = new Date(e).toDateString() === new Date(nowMs).toDateString();
  const until = sameDay ? clock(e) : `${new Date(e).toLocaleDateString([], { weekday: 'short' })} ${clock(e)}`;
  const lead = s != null && kind === 'event' ? 'Happening now · until' : VERB[kind] ?? 'Until';
  return { phase: 'live', label: `${lead} ${until}`, minutesLeft };
}

// A gathering's wording, using its host-declared duration when it has one (else the start-only rule).
export function gatheringWhen(g, now = new Date()) {
  if (!g?.scheduled_at) return null;
  return timeWindowState({ start: g.scheduled_at, durationMinutes: g.duration_minutes }, now, 'event').label;
}

// One line for a window with explicit start/end (owner-facing lists): the engine's label for a live or upcoming window, null
// once it is over or unreadable (the caller then shows nothing rather than a stale claim).
export function windowPhrase(start, end, kind = 'availability', now = new Date()) {
  const st = timeWindowState({ start, end }, now, kind);
  return st.phase === 'over' || st.phase === 'unknown' ? null : st.label;
}
