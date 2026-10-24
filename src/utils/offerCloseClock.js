// Owner idea "393" (2026-10-24): an offer that stops being acceptable while its request screen is open loses "I'll take this
// one" at that instant, not at the next reload. A data-freshness fix, NOT motion (like item 108's minute clock): the screen
// just re-renders and consumerOfferAction / presentOffer re-read the time (their default `now`), so the closed card and
// "This offer has expired" appear from the one rule that already decides them.
//
// The instant = the earliest future deadline among the shown offers that are acceptable right now: each offer's own
// valid_until and the request's expires_at (whichever comes first closes acceptance; the server refuses at the same instants,
// accept_business_offer). Nothing acceptable = no timer and no AppState listener at all. One timer, re-armed after each
// fire, capped so a far deadline never overflows setTimeout; paused in the background, one catch-up render on return.
// Pure and React-free (hooks/useOfferCloseClock.js injects AppState), so it runs under the plain Node jest setup.
import { consumerOfferAction } from './primaryAction';
import { tr } from '../i18n/translate';

export const MAX_SLEEP_MS = 60 * 60 * 1000;
const PAUSED = new Set(['background', 'inactive']);
const ACCEPTABLE = new Set(['accept_offer', 'confirm_with_group']);

function toMs(v) {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// ctx = the screen's consumerOfferAction context ({ request, hasWinner, isGroupPlanRequest }).
export function nextOfferCloseAt(offers, ctx = {}, nowMs = Date.now()) {
  let best = null;
  for (const o of offers ?? []) {
    if (!ACCEPTABLE.has(consumerOfferAction(o, { ...ctx, now: nowMs }).kind)) continue;
    for (const at of [toMs(o?.valid_until), toMs(ctx.request?.expires_at)]) {
      if (at != null && at > nowMs && (best == null || at < best)) best = at;
    }
  }
  return best;
}

export function startOfferCloseClock(offers, ctx, onTick, { appState = null, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (nextOfferCloseAt(offers, ctx, now()) == null) return () => {};
  let timer = null;
  let stopped = false;
  const paused = () => !!appState && PAUSED.has(appState.currentState);
  const cancel = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const schedule = () => {
    cancel();
    if (stopped || paused()) return;
    const at = nextOfferCloseAt(offers, ctx, now());
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

// A tap that reached the server just after the deadline: accept_business_offer refuses with these exact sentences. Shown in
// the existing words, no Try Again (it would fail the same way); anything else returns null (the screen's usual error).
const REFUSALS = [
  ['This offer has expired.', 'ui.requestDetail.thisOfferHasExpired'],
  ['This request has closed.', 'ui.actions.requestClosed'],
];
export function offerCloseRefusal(error) {
  const msg = String(error?.message ?? '');
  const hit = REFUSALS.find(([m]) => msg.includes(m));
  return hit ? tr(hit[1]) : null;
}
