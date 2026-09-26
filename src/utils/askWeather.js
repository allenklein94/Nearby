// Weather-aware ranking for typed asks (2026-09-26, owner decision: weather NUDGES, never dictates). A quiet ranking input on
// the intent resolver only (typed asks, and what inherits its ranking: Surprise Me, multi-part plans). No screen, no preference,
// no feed, no business, people or sponsored use. Uses the weather Nearby already fetches (getSocialForecast: 3-hour forecast
// blocks + sunrise/sunset) and the existing judgement at a moment (utils/weatherWindow.js); no new provider.
//
// WHEN is judged, never guessed:
//   - a gathering: its own real start time (the activity's actual time)
//   - any other result: the window the person's own words anchor (constants/clockWindow.js dateAnchorFromText):
//       "right now" -> the next 2 hours; "tonight" -> this evening (from 5 PM, or now if later, to 11 PM);
//       "today" / "tomorrow" / "Saturday" -> that day's daytime (9 AM, or now if later, to 9 PM);
//       an anchored clock window ("Saturday before 3 PM") narrows that day.
//     "this weekend" with no day chosen, "next weekend", or no date word = NO window: weather says nothing.
//   Today's conditions are never used for another day.
// A window is judged by CONSENSUS: every hour in it must be covered by a forecast block and agree: all indoor-worthy, or a known
// good outdoor window in daylight with every remaining (after-dark) hour still dry and mild. Any gap or disagreement = uncertain
// = neutral. So "rain for part of the evening" says nothing.
//
// Suitability (small on purpose; thresholds are the existing ones in weatherWindow.js):
//   indoor-worthy (storm/snow, rain chance >= 60%, > 95F, < 45F)  -> indoor +W, outdoor -W, weather-dependent business -W
//   known good outdoor window (dry, comfortable, daylight)        -> outdoor +W
//   anything else / unknown                                        -> 0
// A result's indoor/outdoor comes ONLY from existing metadata: the business's own declared weather_setting (item 63), else its
// category through askFacets.environmentOf (the shared indoor/outdoor map + the Outdoors & Nature group). Unclassified = 0.
// Nothing is ever removed. An EXPLICIT environment in the ask ("outdoor pickleball") is never reinterpreted: bad weather then
// lifts no indoor alternative, and good weather adds nothing to the other side either; only a factual note is shown.

import { gatheringWeatherWindow, blockAt } from './weatherWindow';
import { environmentOf } from '../constants/askFacets';
import { dateAnchorFromText, clockWindowFromText } from '../constants/clockWindow';

export const WEATHER_POINTS = 2; // same modest weight as the pre-existing weather nudge (SCORE_HAPPENING_NOW)
const HOUR = 60 * 60 * 1000;

const at = (day, minutes) => { const d = new Date(day); d.setHours(0, 0, 0, 0); return d.getTime() + minutes * 60 * 1000; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// -> { startMs, endMs, when } | null. `when` is the person's own word for the caption.
export function askWeatherWindow(text, now = new Date()) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const anchor = dateAnchorFromText(text, now);
  if (!anchor || anchor.kind !== 'day' || anchor.dates?.length !== 1) return null; // a weekend period is never narrowed to a day
  const day = anchor.dates[0];
  const t = text.toLowerCase();
  const isToday = sameDay(day, now);
  const nowMs = now.getTime();
  const clock = clockWindowFromText(text);

  if (isToday && /\bright\s+now\b|\bnow\b/.test(t) && !/\btonight\b/.test(t) && !clock) {
    return { startMs: nowMs, endMs: nowMs + 2 * HOUR, when: 'right now' };
  }
  const evening = /\b(tonight|tonite|this\s+evening)\b/.test(t);
  let lo = evening ? 17 * 60 : 9 * 60;
  let hi = evening ? 23 * 60 : 21 * 60;
  if (clock) { lo = clock.after ?? lo; hi = clock.before ?? hi; }
  let startMs = at(day, lo);
  const endMs = at(day, hi);
  if (isToday) startMs = Math.max(startMs, nowMs);
  if (endMs <= startMs) return null;
  const dayWord = isToday ? (evening ? 'tonight' : 'today') : /\btomorrow\b/.test(t) ? 'tomorrow' : day.toLocaleDateString('en-US', { weekday: 'long' });
  return { startMs, endMs, when: evening && !isToday ? `${dayWord} evening` : dayWord };
}

// Consensus judgement over a window. -> { bias, kind, label } | { unknown: true } (no data / not covered) | null (mixed).
export function judgeWeatherWindow(weather, win) {
  if (!win) return null;
  if (!weather || !Array.isArray(weather.forecast_blocks) || !weather.forecast_blocks.length) return { unknown: true };
  const samples = [];
  for (let ms = win.startMs; ms < win.endMs; ms += HOUR) samples.push(ms);
  if (!samples.length) samples.push(win.startMs);
  const covered = samples.every((ms) => blockAt(weather, ms));
  if (!covered) return { unknown: true };
  const judged = samples.map((ms) => gatheringWeatherWindow(weather, new Date(ms).toISOString()));
  if (judged.some((j) => j?.bias === 'indoor')) {
    return judged.every((j) => j?.bias === 'indoor') ? worstIndoor(judged) : null;
  }
  // No indoor-worthy hour: outdoor only when at least one daylight hour is a good window and every other hour is a dry, mild
  // after-dark hour (weatherWindow.js returns null for those because it never calls night "favorable").
  const outdoor = judged.filter((j) => j?.bias === 'outdoor').length;
  const dryNight = (ms) => { const b = blockAt(weather, ms); return b && Number(b.pop) < 0.3 && Number(b.temp) >= 45 && Number(b.temp) <= 95; };
  if (!outdoor || !samples.every((ms, i) => judged[i]?.bias === 'outdoor' || dryNight(ms))) return null;
  return { bias: 'outdoor', kind: 'outdoor_window', label: 'Good outdoor weather' };
}

function worstIndoor(judged) {
  const order = ['storm', 'snow', 'wet', 'heat', 'cold'];
  const worst = judged.reduce((a, j) => (order.indexOf(j.kind) < order.indexOf(a.kind) ? j : a));
  return { bias: 'indoor', kind: worst.kind, label: worst.label };
}

// A result's environment from existing metadata only.
export function resultEnvironment(c, weatherSetting = null) {
  if (weatherSetting === 'indoor' || weatherSetting === 'outdoor' || weatherSetting === 'weather_dependent') return weatherSetting;
  return environmentOf(c?.category);
}

export function weatherDelta(env, judgement, explicitEnvironment = null) {
  if (!env || !judgement?.bias) return 0;
  if (explicitEnvironment && explicitEnvironment !== judgement.bias) return 0; // never reinterpret the person's own ask
  if (judgement.bias === 'indoor') {
    if (env === 'indoor') return WEATHER_POINTS;
    if (env === 'outdoor' || env === 'weather_dependent') return -WEATHER_POINTS;
    return 0;
  }
  return env === 'outdoor' ? WEATHER_POINTS : 0;
}

// Re-scores only; never removes. Gatherings are judged at their own start; everything else at the ask's window (none = 0).
// settingByPartnerId: Map partnerId -> declared weather_setting (optional). Returns { items, caption }.
export function applyAskWeather(candidates, weather, { text = '', now = new Date(), explicitEnvironment = null, settingByPartnerId = null } = {}) {
  if (!Array.isArray(candidates)) return { items: candidates, caption: null };
  const win = askWeatherWindow(text, now);
  const askJudgement = judgeWeatherWindow(weather, win);
  let moved = false;
  const items = candidates.map((c) => {
    const setting = c?.partnerId && settingByPartnerId instanceof Map ? settingByPartnerId.get(c.partnerId) : null;
    const env = resultEnvironment(c, setting);
    if (!env) return c;
    const own = c?.type === 'gathering' && c?.startsAt;
    const judgement = own ? gatheringWeatherWindow(weather, c.startsAt) : askJudgement;
    const delta = weatherDelta(env, judgement, explicitEnvironment);
    if (!delta) return c;
    // the caption speaks only about the person's window, so only moves judged inside it count toward it
    const startMs = own ? new Date(c.startsAt).getTime() : null;
    if (!own || (win && startMs >= win.startMs && startMs < win.endMs)) moved = true;
    return { ...c, score: (c.score ?? 0) + delta };
  });
  return { items, caption: askWeatherCaption(askJudgement, win, { moved, explicitEnvironment }) };
}

// Factual, subtle, and only about the window the person named. Never "you should", never "best".
export function askWeatherCaption(judgement, win, { moved = false, explicitEnvironment = null } = {}) {
  if (!win || !judgement) return null;
  if (judgement.unknown) return explicitEnvironment ? 'Weather data unavailable' : null;
  const fact = judgement.bias === 'indoor' ? `${judgement.label} ${win.when}` : `Good outdoor weather ${win.when}`;
  if (explicitEnvironment && explicitEnvironment !== judgement.bias) return fact; // a note, not a re-ranking claim
  if (!moved) return null;
  return judgement.bias === 'indoor' ? `${fact} — indoor options are higher` : `${fact} — outdoor options are higher`;
}
