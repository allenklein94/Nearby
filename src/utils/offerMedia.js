import { timeWindowState, ENDING_SOON_MIN } from './timeWindow';
// Rich offers, Phase 2 (PRODUCT_AUDIT/OFFER_MEDIA_MODEL_2026-09-20.md). Pure rules shared by the sender and the tests.
// A video offer is screened through up to three preview frames sampled from it (the first becomes its poster); the server
// enforces the same size cap and refuses a video with no frames.

import { formatTimeOfDay } from './businessRequestWhen';
import { tr } from '../i18n/translate';

const M = (key) => tr(`ui.bizHelp.offerForm.${key}`);

export const MAX_OFFER_VIDEO_MS = 30 * 1000;
export const MAX_OFFER_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_REDEMPTION_LENGTH = 500;

// Times (ms) to sample: start, middle, near the end. A short/unknown clip gets fewer, distinct, in-range times.
export function videoFrameTimes(durationMs) {
  const d = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (d < 1500) return [0];
  const last = Math.max(0, Math.floor(d) - 500);
  return [...new Set([0, Math.floor(d / 2), last])];
}

// A plain-words problem with a picked video, or null when it is fine. Images are never limited here.
// The length must be known (owner, 2026-10-10): a video whose duration is missing or not a real positive number
// (undefined, null, NaN, Infinity, a string, 0 or less) is refused before upload, never let through unchecked.
// Up to and including 30 seconds passes; longer is refused, never trimmed by Nearby.
export function videoLimitProblem(asset) {
  if (!asset || asset.type !== 'video') return null;
  const d = asset.duration;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return M('videoNoDuration');
  if (d > MAX_OFFER_VIDEO_MS) return M('videoTooLong');
  if (Number.isFinite(asset.fileSize) && asset.fileSize > MAX_OFFER_VIDEO_BYTES) return M('videoTooBig');
  return null;
}

// Redemption instructions shown to the customer only once the offer is theirs (accepted/completed).
export function visibleRedemption(offer) {
  const text = typeof offer?.redemption_instructions === 'string' ? offer.redemption_instructions.trim() : '';
  if (!text) return null;
  return offer.status === 'accepted' || offer.status === 'completed' ? text : null;
}

// ---- Structured offer validity ("Valid today until 7 PM"): owner-picked, deterministic, never inferred. ----

// day: 'today' | 'tomorrow'; time: a Date whose local hours/minutes are the chosen end time. Returns { iso } or { error }.
export function validUntilFromChoice(day, time, now = new Date()) {
  if (!day) return { iso: null };
  // A day with no time (e.g. "Today" preselected from a creative's wording) is never sent as "no end time": the owner picks the time.
  if (!time) return { error: M('pickEndTime') };
  const end = new Date(now);
  end.setHours(time.getHours(), time.getMinutes(), 0, 0);
  if (day === 'tomorrow') end.setDate(end.getDate() + 1);
  if (end.getTime() <= now.getTime()) return { error: M('endLaterThanNow') };
  return { iso: end.toISOString() };
}

// "Valid until 7 PM" (same day), "Valid until Sat 7 PM" (another day); 'expired' once it has passed; null with no end time.
export function validityLabel(validUntil, now = new Date()) {
  if (!validUntil) return null;
  const end = new Date(validUntil);
  if (Number.isNaN(end.getTime())) return null;
  const st = timeWindowState({ end: end.toISOString() }, now, 'offer');
  return st.phase === 'over' ? 'expired' : st.label;
}

// When an open offer's validity text next changes, so a screen left open re-renders right then (text only, no motion):
// "Valid until 7 PM" -> "Ends in 30 min" at the 30-minute mark, then each minute ("Ends in 29 min"...), then "expired".
// null = nothing will change (no end, a bad date, already over). Long waits are capped and simply re-checked.
const REFRESH_SLACK_MS = 50;
const MAX_REFRESH_WAIT_MS = 6 * 3600e3;
export function validityRefreshDelayMs(validUntil, now = new Date()) {
  if (!validUntil) return null;
  const end = new Date(validUntil).getTime();
  if (Number.isNaN(end)) return null;
  const left = end - now.getTime();
  if (left <= 0) return null;
  const soonMs = ENDING_SOON_MIN * 60000;
  if (left > soonMs) return Math.min(left - soonMs + REFRESH_SLACK_MS, MAX_REFRESH_WAIT_MS);
  // the label shows ceil(left / 1 min); it next changes when that drops by one (at 0 = expired)
  const shown = Math.ceil(left / 60000);
  return left - (shown - 1) * 60000 + REFRESH_SLACK_MS;
}

// The soonest change across several offers (null = none).
export function nextValidityRefreshMs(offers, now = new Date()) {
  const delays = (offers ?? [])
    .filter((o) => o?.status === 'offered' && o.valid_until)
    .map((o) => validityRefreshDelayMs(o.valid_until, now))
    .filter((d) => d != null);
  return delays.length ? Math.min(...delays) : null;
}

// Owner-set available window ("Available 6-8 PM"): a time-of-day range for the day the visit is for. Both ends or neither.
// from/to are Dates whose local hours/minutes are the chosen times. Returns { from, until } as 'HH:MM' (nulls = no window)
// or { error }. The server (submit_business_offer, edge function) enforces the same rule.
export function availableWindowFromChoice(from, to) {
  if (!from && !to) return { from: null, until: null };
  if (!from || !to) return { error: M('windowBothEnds') };
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const f = hhmm(from);
  const u = hhmm(to);
  if (u <= f) return { error: M('windowEndAfterStart') };
  return { from: f, until: u };
}

// "Available 6-8 PM" from the stored 'HH:MM[:SS]' values; null when there is no complete window.
export function availableWindowLabel(from, until) {
  if (!from || !until) return null;
  const a = formatTimeOfDay(from);
  const b = formatTimeOfDay(until);
  if (!a || !b) return null;
  return a.slice(-2) === b.slice(-2) ? `Available ${a.slice(0, -3)}–${b}` : `Available ${a}–${b}`;
}

// Derived Expired state lives in utils/objectState.js; re-exported so imports keep working.
export { isOfferExpired } from './objectState';
