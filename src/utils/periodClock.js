// Idea "202" follow-up (owner, 2026-10-18): Home's time-of-day wording and quick picks stay true while Home stays open.
// A data-freshness fix like item 108's minute clock, NOT motion: Home keeps reading getTimePeriod / getGreeting at render;
// this only guarantees a render when their answer really changed (homeMomentKey). One timer to the next local boundary
// (noon, 6 PM, midnight; long sleeps capped and re-checked), none in the background, one re-check on return to the
// foreground. No polling, no change = no call.
// Pure and React-free (hooks/usePeriodClock.js injects AppState), so it runs under the plain Node jest setup.
import { homeMomentKey, nextHomeMomentBoundary } from './timeContext';

export const MAX_SLEEP_MS = 60 * 60000;

const PAUSED = new Set(['background', 'inactive']);

// Starts the clock; returns stop(). onChange(key) is called only when homeMomentKey differs from the last one seen.
export function startPeriodClock(onChange, { appState = null, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let key = homeMomentKey(new Date(now()));
  let timer = null;
  let stopped = false;
  const paused = () => !!appState && PAUSED.has(appState.currentState);
  const cancel = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const check = () => {
    const next = homeMomentKey(new Date(now()));
    if (next !== key) { key = next; onChange(next); }
  };
  const schedule = () => {
    cancel();
    if (stopped || paused()) return;
    const at = nextHomeMomentBoundary(new Date(now()));
    timer = setTimer(() => {
      timer = null;
      check();
      schedule();
    }, Math.min(Math.max(at - now(), 0), MAX_SLEEP_MS));
  };
  const sub = appState?.addEventListener?.('change', (state) => {
    if (PAUSED.has(state)) { cancel(); return; }
    if (state === 'active') { check(); schedule(); }
  });
  schedule();
  return () => { stopped = true; cancel(); sub?.remove?.(); };
}
