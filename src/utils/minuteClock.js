// Owner item 108 (2026-10-15): relative time labels stay true while the screen is open. A data-freshness fix, NOT motion:
// the label's text is simply re-read from the one time engine (utils/timeWindow.js -> timeContext.whenLabel); no fade,
// pulse, bar or urgency styling (item 47's amber bar stays offer-only).
//
// Without it, a card that said "Starts in 42 min" when the screen rendered kept saying 42 (or "Starts in 1 min" after the
// gathering began) until something else redrew the screen. The clock only runs while a shown window is in or about to enter
// its relative span, ticks on minute boundaries, and stops in the background (one catch-up tick on return).
//
// A window's relative span (the engine's own rules, nothing new):
//   from  start - STARTS_IN_WINDOW_MIN ("Starts in 60 min")            [end - ENDING_SOON_MIN when only an end is known]
//   to    end, else start + JUST_STARTED_MIN ("Happening now" stops), + one minute so the plain label replaces it
// Before `from` the clock sleeps until `from` (capped at MAX_SLEEP_MS); after `to` the window needs nothing. Nothing in or
// ahead of its span = no timer and no AppState listener at all.
// Midnight follow-up (owner, 2026-10-18): an upcoming window's day word (whenParts: Today/Tonight, Tomorrow, then the date)
// also changes at local midnight: the day before its start ("Mon, Oct 19" -> "Tomorrow") and its own day ("Tomorrow" ->
// "Today"). Those two midnights are ticks too, so no second clock: same timer, same cap, same background pause.
// Pure and React-free (the hook hooks/useMinuteClock.js injects AppState), so it runs under the plain Node jest setup.
import { STARTS_IN_WINDOW_MIN } from './timeContext';
import { windowEnd, ENDING_SOON_MIN, JUST_STARTED_MIN } from './timeWindow';

export const MINUTE_MS = 60000;
export const MAX_SLEEP_MS = 60 * MINUTE_MS;

function toMs(v) {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// One shown thing -> its window, or null. Gatherings (scheduled_at + duration_minutes), resolver/context items (startsAt +
// durationMinutes), availability postings (postingStartsAt/postingEndsAt), and wrappers carrying `.gathering`.
export function windowOf(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.gathering && typeof x.gathering === 'object') return windowOf(x.gathering);
  const start = toMs(x.scheduled_at ?? x.startsAt ?? x.postingStartsAt ?? null);
  const durationMinutes = x.duration_minutes ?? x.durationMinutes ?? null;
  const end = windowEnd({ start, end: x.postingEndsAt ?? null, durationMinutes });
  return start == null && end == null ? null : { start, end };
}

// Every list (or single object) a screen shows -> its windows.
export function relativeWindows(...sources) {
  const out = [];
  for (const s of sources) {
    for (const x of Array.isArray(s) ? s : [s]) {
      const w = windowOf(x);
      if (w) out.push(w);
    }
  }
  return out;
}

// A stable identity for a set of windows (the hook restarts the clock only when this changes).
export function windowsKey(windows) {
  return (windows ?? []).map((w) => `${w.start ?? ''}-${w.end ?? ''}`).sort().join('|');
}

export function relativeSpan({ start, end }) {
  const from = start != null ? start - STARTS_IN_WINDOW_MIN * MINUTE_MS : end - ENDING_SOON_MIN * MINUTE_MS;
  const to = (end ?? start + JUST_STARTED_MIN * MINUTE_MS) + MINUTE_MS;
  return { from, to };
}

// The next local midnight (ms) at which an upcoming start's day word changes, or null (already started, or its day is
// today). Local wall clock via the Date ctor: DST, month-end and year-end safe.
export function dayWordChangeAt(start, nowMs) {
  if (start == null || start <= nowMs) return null;
  const s = new Date(start);
  for (const t of [new Date(s.getFullYear(), s.getMonth(), s.getDate() - 1), new Date(s.getFullYear(), s.getMonth(), s.getDate())]) {
    if (t.getTime() > nowMs) return t.getTime();
  }
  return null;
}

// When any shown label can next change (ms), or null when none ever will.
export function nextTickAt(windows, nowMs) {
  let next = null;
  for (const w of windows ?? []) {
    const { from, to } = relativeSpan(w);
    if (nowMs >= to) continue;
    const t = nowMs >= from ? (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS : from;
    if (next == null || t < next) next = t;
    const day = dayWordChangeAt(w.start, nowMs);
    if (day != null && day < next) next = day;
  }
  return next;
}

const PAUSED = new Set(['background', 'inactive']);

// Starts the clock; returns stop(). onTick(nowMs) is called only when a label may really have changed (a minute boundary in
// a span, a span starting, or the app returning to the foreground). appState: { currentState, addEventListener }.
export function startMinuteClock(windows, onTick, { appState = null, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (nextTickAt(windows, now()) == null) return () => {};
  let timer = null;
  let stopped = false;
  const paused = () => !!appState && PAUSED.has(appState.currentState);
  const cancel = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const schedule = () => {
    cancel();
    if (stopped || paused()) return;
    const at = nextTickAt(windows, now());
    if (at == null) return;
    timer = setTimer(() => {
      timer = null;
      if (now() >= at) onTick(now());
      schedule();
    }, Math.min(Math.max(at - now(), 0), MAX_SLEEP_MS));
  };
  const sub = appState?.addEventListener?.('change', (state) => {
    if (PAUSED.has(state)) { cancel(); return; }
    if (state === 'active') { onTick(now()); schedule(); }
  });
  schedule();
  return () => { stopped = true; cancel(); sub?.remove?.(); };
}
