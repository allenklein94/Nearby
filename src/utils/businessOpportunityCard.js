import { formatDateLabel, formatTimeOfDay } from './businessRequestWhen';
import { formatBudgetLine } from './budgetTier';

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

  const feelLine = [experienceLabel, formatBudgetLine(r.budget_max, r.party_size)].filter(Boolean).join(' · ');

  const lookingFor = [cuisineLabel, ...attributeLabels].filter(Boolean);
  return { title, whenLine, feelLine, lookingFor };
}

// "Why this matches": the trust line on a pending opportunity. Every line traces to a real scoring reason (or, for the
// area line, to the fact that fan-out only reaches businesses inside the request's radius). Nothing is invented: a
// signal that did not fire simply does not appear, and with no reasons the card falls back to "New opportunity".
// Price fit is real now that budget_max is locked as per person (see budgetTier.js): it fires only when the request's
// per-person budget >= the business's own active per-person minimum spend. The availability line is real but narrow: it only appears when the business has an
// ACTIVE posted slot (business_availability) covering the request's date/time -- there are no standing opening hours.
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

// True only when one of the business's own active postings really covers the request: same category (or an uncategorized
// posting), and the posted window contains the requested time -- or, with no requested time, overlaps the requested day.
export function availabilityCoversRequest(req, postings = [], now = new Date()) {
  if (!req?.date) return false;
  const dayStart = new Date(`${req.date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return false;
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  let at = null;
  if (req.time_window_start) {
    const [h, m] = req.time_window_start.split(':').map((n) => parseInt(n, 10));
    if (Number.isInteger(h) && Number.isInteger(m)) at = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), h, m);
  }
  return (postings ?? []).some((a) => {
    if (a.status !== 'active') return false;
    const start = new Date(a.starts_at);
    const end = new Date(a.ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= now) return false;
    if (a.category && req.category && a.category !== req.category) return false;
    return at ? start <= at && at <= end : start < dayEnd && end > dayStart;
  });
}

export function buildMatchReasons(reasons = [], { occasionPhrase = null, hasAvailability = false, priceFits = false } = {}) {
  const keys = new Set((reasons ?? []).map((r) => r.key));
  const lines = REASON_ORDER.filter((k) => keys.has(k)).map((k) => REASON_LINES[k]({ occasionPhrase }));
  if (priceFits) lines.push('Their budget fits your price range');
  if (hasAvailability) lines.push('You have space posted for that time');
  // Fan-out only creates an opportunity for a business inside the request's radius, so this is true by construction.
  lines.push('You are within the area they asked for');
  return lines.length > 1 ? lines : [];
}
