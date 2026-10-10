// Item 11 (owner, 2026-10-10): the business gives Nearby the pieces (a video, "20% off tonight", valid 5-9 PM) and Nearby
// lays out the offer card: header -> media -> 20% OFF -> Tonight · 5–9 PM -> I'll take this one. Pure decisions only, all
// from STRUCTURED offer fields; nothing is parsed out of the business's free text and nothing is invented.
import { timeWindowState } from './timeWindow';
import { TONIGHT_START_HOUR } from './gatheringDateFilter';
import { windowRangeLabel } from './offerMedia';
import { translate, getCurrentLanguage } from '../i18n/translate';
import { localClock } from '../i18n/format';

// The structured discount as a headline number ("20% OFF"), only when the business set a real percentage.
export function discountHeadlinePct(offer) {
  const n = Number(offer?.discount_pct);
  if (offer?.discount_pct == null || !Number.isFinite(n) || n <= 0 || n > 100) return null;
  return Math.round(n);
}

const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// One "when" line instead of "Available 5–9 PM" + "Valid until 9 PM", when the validity says nothing the window does not:
// the offer is valid until a moment on today or tomorrow (device local day, like every date in the app) that is at or
// after the window's end. -> 'tonight' | 'today' | 'tomorrow' | null (null = keep the separate lines as before).
// Never combined while the offer is ending soon or over, so the live "Ends in 20 min" countdown and "expired" stay visible.
// "Tonight" uses the app's one boundary (a window starting at 6 PM or later), else "Today".
export function offerWhenDay(offer, now = new Date()) {
  const from = minutesOf(offer?.available_from);
  const until = minutesOf(offer?.available_until);
  if (from == null || until == null || until <= from || !offer?.valid_until) return null;
  const end = new Date(offer.valid_until);
  if (Number.isNaN(end.getTime())) return null;
  const phase = timeWindowState({ end: end.toISOString() }, now, 'offer').phase;
  if (phase === 'ending_soon' || phase === 'over' || phase === 'unknown') return null;
  const days = Math.round((dayStart(end) - dayStart(now)) / 86400000);
  if (days !== 0 && days !== 1) return null;
  if (end.getHours() * 60 + end.getMinutes() < until) return null; // ends before the window does: say so separately
  if (days === 1) return 'tomorrow';
  return from >= TONIGHT_START_HOUR * 60 ? 'tonight' : 'today';
}

// "Tonight · 5–9 PM": the day word + the window alone, in the person's language (English keeps its own clock format).
export function offerWhenLineText(day, from, until, language = getCurrentLanguage()) {
  const english = !language || language === 'en';
  const range = english ? windowRangeLabel(from, until) : `${localClock(minutesOf(from), language)}–${localClock(minutesOf(until), language)}`;
  return translate(language, 'ui.requestDetail.dayWindow', { day: translate(language, `ui.requestDetail.whenDay.${day}`), window: range });
}
