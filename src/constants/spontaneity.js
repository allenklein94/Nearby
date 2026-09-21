// Spontaneity (owner item 46, 2026-09-21): how soon the person wants to be doing it -- now, the next few hours, tonight, tomorrow,
// this weekend, or plan ahead. The extractor already gives `dateWindow` (now/today/tonight/tomorrow/weekend/flexible); this adds the two
// it has no bucket for from the person's own words (deterministic, never AI): "next several hours" and "plan ahead". It shapes RANKING
// (sooner starts first for an immediate ask; a few days out first for plan-ahead) and one honest caption; never a filter, and no time
// is ever invented. An immediate ask (now / next hours) implies a LIGHT commitment unless the person said otherwise.
export const SPONTANEITY = ['now', 'next_hours', 'tonight', 'tomorrow', 'weekend', 'plan_ahead'];

const NEXT_HOURS = /\b(in\s+(a\s+)?(couple|few|several)\s+(of\s+)?hours?|later\s+today|this\s+afternoon|next\s+(few|couple|several)\s+hours|within\s+(the\s+)?(next\s+)?(few\s+)?hours?)\b/i;
const PLAN_AHEAD = /\bplan\s+ahead\b|\bin\s+advance\b|\bnext\s+(week|month)\b|\bin\s+(a\s+)?(few|couple)\s+(of\s+)?(weeks|days)\b|\blater\s+this\s+month\b|\bsometime\s+soon\b/i;

export function spontaneityOf({ dateWindow = null, rawText = '' } = {}) {
  const t = typeof rawText === 'string' ? rawText : '';
  if (dateWindow === 'now') return 'now';
  if (NEXT_HOURS.test(t)) return 'next_hours';
  if (PLAN_AHEAD.test(t)) return 'plan_ahead';
  if (['tonight', 'tomorrow', 'weekend'].includes(dateWindow)) return dateWindow;
  return null; // today / flexible / nothing said: no claim
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
  return 0; // tonight / tomorrow / weekend are already windows the resolver filters on
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
};
export function spontaneityCaption(spont) {
  return CAPTION[spont] ?? null;
}
