import { formatDateLabel, formatTimeOfDay } from './businessRequestWhen';

// The business-facing "opportunity card": what a business needs to decide in two seconds whether it can do this.
// Built ONLY from the structured fields get_business_opportunities already returns (never raw text, never invented
// tiers): a title, one "who / when" line, one "how special / how much" line, and what the customer is looking for.
// Labels are injected so this stays dependency-free and unit-testable.
export function buildOpportunityCard(req, { occasionLabel, experienceLabel, addonLabel, attributeLabels = [], cuisineLabel = null }) {
  const r = req ?? {};
  const kind = addonLabel ? `${addonLabel} add-on` : r.category;
  const title = [occasionLabel, kind].filter(Boolean).join(' · ') || r.summary || 'New request';

  const start = r.time_window_start ? formatTimeOfDay(r.time_window_start) : null;
  const end = r.time_window_end ? formatTimeOfDay(r.time_window_end) : null;
  // "7–8 PM" when both ends share AM/PM, else "11 AM–1 PM".
  const timeLabel = start
    ? end
      ? (start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`)
      : start
    : null;
  const whenLine = [
    r.party_size ? `${r.party_size} ${r.party_size === 1 ? 'person' : 'people'}` : null,
    formatDateLabel(r.date),
    timeLabel,
  ].filter(Boolean).join(' · ');

  const feelLine = [experienceLabel, r.budget_max ? `up to $${r.budget_max}` : null].filter(Boolean).join(' · ');

  const lookingFor = [cuisineLabel, ...attributeLabels].filter(Boolean);
  return { title, whenLine, feelLine, lookingFor };
}

// "Why this matches": the trust line on a pending opportunity. Every line traces to a real scoring reason (or, for the
// area line, to the fact that fan-out only reaches businesses inside the request's radius). Nothing is invented: a
// signal that did not fire simply does not appear, and with no reasons the card falls back to "New opportunity".
// Deliberately absent: a price-range line (budget_max is not established as per-person, so "matches your price range"
// would be a claim we cannot back) and an availability line (no per-business hours data exists).
const REASON_LINES = {
  offered_occasion: (ctx) => `You offer ${ctx.occasionPhrase ?? 'this occasion'}`,
  want_occasion: (ctx) => `You've said you want more ${ctx.occasionPhrase ?? 'requests like this'}`,
  priority_attribute: () => 'It matches what you said you want more of',
  offers_attribute: () => 'You offer what they are looking for',
  cuisine: () => 'It matches your cuisine',
  party_size: () => 'The party fits your usual group size',
  time_window: () => 'It fits the hours you want to fill',
  weekday: () => 'A weekday request, which you want more of',
  last_minute: () => 'A last-minute booking, which you want more of',
  boost: () => "You're actively boosting this category",
};
const REASON_ORDER = ['offered_occasion', 'want_occasion', 'priority_attribute', 'offers_attribute', 'cuisine', 'party_size', 'time_window', 'weekday', 'last_minute', 'boost'];

export function buildMatchReasons(reasons = [], { occasionPhrase = null } = {}) {
  const keys = new Set((reasons ?? []).map((r) => r.key));
  const lines = REASON_ORDER.filter((k) => keys.has(k)).map((k) => REASON_LINES[k]({ occasionPhrase }));
  // Fan-out only creates an opportunity for a business inside the request's radius, so this is true by construction.
  lines.push('You are within the area they asked for');
  return lines.length > 1 ? lines : [];
}
