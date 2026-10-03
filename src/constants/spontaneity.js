// Spontaneity (owner item 46, 2026-09-21): how soon the person wants to be doing it -- now, the next few hours, tonight, tomorrow,
// this weekend, or plan ahead. The extractor already gives `dateWindow` (now/today/tonight/tomorrow/weekend/flexible); this adds the two
// it has no bucket for from the person's own words (deterministic, never AI): "next several hours" and "plan ahead". It shapes RANKING
// (sooner starts first for an immediate ask; a few days out first for plan-ahead) and one honest caption; never a filter, and no time
// is ever invented. An immediate ask (now / next hours) implies a LIGHT commitment unless the person said otherwise.
//
// Urgency (owner item 163, 2026-10-03): this scale IS the urgency of an ask; no second field. The owner's levels map onto it:
// Now (incl. ASAP / as soon as possible / right away, via dateWindow 'now') -> 'now', Today -> 'today', Tonight -> 'tonight',
// This week -> 'this_week', No rush -> 'no_rush'. Words only. An explicit time beats "no rush" ("no rush, sometime this week" =
// this week; "no rush, tomorrow" = tomorrow). Effects stay ranking-only: this week lifts starts before the end of this
// Sunday; no rush lifts nothing, is never immediate (no implied light commitment) and, for a NEED ask, does not let
// "open right now" decide (utils/needAsk.js). Today/tonight/tomorrow/weekend are windows the resolver already filters on.
export const SPONTANEITY = ['now', 'next_hours', 'today', 'tonight', 'tomorrow', 'this_week', 'weekend', 'plan_ahead', 'no_rush'];

const NEXT_HOURS = /\b(in\s+(a\s+)?(couple|few|several)\s+(of\s+)?hours?|later\s+today|this\s+afternoon|next\s+(few|couple|several)\s+hours|within\s+(the\s+)?(next\s+)?(few\s+)?hours?)\b/i;
const PLAN_AHEAD = /\bplan\s+ahead\b|\bin\s+advance\b|\bnext\s+(week|month)\b|\bin\s+(a\s+)?(few|couple)\s+(of\s+)?(weeks|days)\b|\blater\s+this\s+month\b|\bsometime\s+soon\b/i;
// "this week" never matches "this weekend" (\b after week).
const THIS_WEEK = /\b(this|later\s+this|this\s+coming)\s+week\b|\bby\s+the\s+end\s+of\s+(the|this)\s+week\b|\bwithin\s+the\s+week\b/i;
const NO_RUSH = /\b(no\s+rush|no\s+hurry|not\s+in\s+(a|any)\s+(rush|hurry)|in\s+no\s+(rush|hurry)|not\s+urgent|no\s+urgency|whenever(\s+works)?|no\s+time\s+pressure)\b/i;

export function spontaneityOf({ dateWindow = null, rawText = '' } = {}) {
  const t = typeof rawText === 'string' ? rawText : '';
  if (dateWindow === 'now') return 'now';
  if (NEXT_HOURS.test(t)) return 'next_hours';
  if (PLAN_AHEAD.test(t)) return 'plan_ahead';
  if (['today', 'tonight', 'tomorrow', 'weekend'].includes(dateWindow)) return dateWindow;
  if (THIS_WEEK.test(t)) return 'this_week';
  if (NO_RUSH.test(t)) return 'no_rush';
  return null; // flexible / nothing said: no claim
}

// End of this Sunday, local (the end of "this week"; on a Sunday, tonight's midnight).
export function endOfThisWeek(now = Date.now()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); // to the Monday 00:00 that ends this Sunday
  return d.getTime();
}

export const isImmediate = (s) => s === 'now' || s === 'next_hours';

const HOUR = 3600000;
export const SPONTANEITY_POINTS = 2;

// Ranking nudge for a candidate that has a real start time (`startsAt`, ISO). Others (businesses with no posting time) are untouched.
export function spontaneityDelta(startsAt, spont, now = Date.now()) {
  if (!spont || !startsAt) return 0;
  const t = new Date(startsAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const ahead = t - now;
  if (spont === 'now') return ahead <= 2 * HOUR ? SPONTANEITY_POINTS : 0;
  if (spont === 'next_hours') return ahead <= 6 * HOUR ? SPONTANEITY_POINTS : 0;
  if (spont === 'plan_ahead') return ahead >= 3 * 24 * HOUR ? SPONTANEITY_POINTS : 0;
  if (spont === 'this_week') return ahead >= 0 && t < endOfThisWeek(now) ? SPONTANEITY_POINTS : 0;
  return 0; // today / tonight / tomorrow / weekend are already windows the resolver filters on; no rush lifts nothing
}

export function applySpontaneityToCandidates(candidates, spont, now = Date.now()) {
  if (!spont) return candidates;
  return candidates.map((c) => {
    const d = spontaneityDelta(c?.startsAt, spont, now);
    return d ? { ...c, score: (c.score ?? 0) + d } : c;
  });
}

const CAPTION = {
  now: 'Showing what is happening right now',
  next_hours: 'Showing what starts in the next few hours',
  plan_ahead: 'Looking ahead: plans a few days out come first',
  this_week: 'Showing what happens this week first',
  no_rush: 'No rush: showing the best fit, not just the soonest',
};
export function spontaneityCaption(spont) {
  return CAPTION[spont] ?? null;
}
