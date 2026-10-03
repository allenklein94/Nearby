import { formatBudgetLine } from './budgetTier';
import { bizMoney } from '../i18n/bizFormat';
import { tr } from '../i18n/translate';
import { bizDate, bizTimeRange, bizClock } from '../i18n/bizFormat';

const P = (key, vars) => tr(`ui.bizHelp.opportunity.${key}`, vars);

// The business-facing "opportunity card": what a business needs to decide in two seconds whether it can do this.
// Built ONLY from the structured fields get_business_opportunities already returns (never raw text, never invented
// tiers): a title, one "who / when" line, one "how special / how much" line, and what the customer is looking for.
// Labels are injected so this stays dependency-free and unit-testable.
export function buildOpportunityCard(req, { occasionLabel, experienceLabel, addonLabel, attributeLabels = [], cuisineLabel = null, itemLabels = [], categoryLabel = null }) {
  const r = req ?? {};
  // `categoryLabel` = the category's name in the viewer's language (the caller translates it); r.category is the stored value.
  const cat = categoryLabel ?? r.category;
  const kind = addonLabel ? P('addon', { addon: addonLabel }) : (r.gatherings && r.category ? P('categoryGathering', { category: cat }) : r.gatherings ? P('gathering') : cat);
  const title = [occasionLabel, kind].filter(Boolean).join(' · ') || r.summary || P('newRequest');

  // "7–8 PM" when both ends share AM/PM, else "11 AM–1 PM".
  const timeLabel = r.time_window_start ? bizTimeRange(r.time_window_start, r.time_window_end) : null;
  const whenLine = [
    r.party_size ? P('people', { count: r.party_size }) : null,
    bizDate(r.date),
    timeLabel,
  ].filter(Boolean).join(' · ');

  const potential = potentialValue(r);
  // With a potential value shown, the budget line drops its "$360 for the party" part so the total is said once.
  const feelLine = [experienceLabel, formatBudgetLine(r.budget_max, potential ? null : r.party_size)].filter(Boolean).join(' · ');

  const lookingFor = [cuisineLabel, ...attributeLabels].filter(Boolean);
  // "Coffee + Pastries": what the customer picked from the closed list; absent when they picked nothing.
  const requestedLine = itemLabels.length > 0 ? itemLabels.join(' + ') : '';
  return { title, whenLine, feelLine, lookingFor, requestedLine, potential, needsLine: requestTimingLabel(r) };
}

// Item 164 (owner, 2026-10-03, LOCKED): the customer's EXPLICIT requested timing as one request-level line on the card:
// "Needs this today" / "Needs this tomorrow at 7 PM" / "Needs this Fri, Oct 9". Read ONLY from the request's own stored
// day (`date`) and start time (`time_window_start`), the same fields the who/when line shows. No day = flexible / no rush /
// not said = no line (a time with no day says nothing either). A past day = no line. Never the need/want classification,
// urgency level, a score, ranking, the customer's searches or anything learned; routing and eligibility do not read it.
// "Today" is the device's local calendar day, like every date label on the dashboard (no business timezone is stored).
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function requestTimingLabel(req, now = new Date()) {
  const r = req ?? {};
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(r.date)) return null;
  const day = r.date.slice(0, 10);
  const today = ymd(now);
  if (day < today) return null;
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const time = r.time_window_start ? bizClock(r.time_window_start) : null;
  const at = time ? 'At' : '';
  if (day === today) return P(`needs.today${at}`, { time });
  if (day === tomorrow) return P(`needs.tomorrow${at}`, { time });
  const label = bizDate(day);
  return label ? P(`needs.on${at}`, { day: label, time }) : null;
}

// Item 149 (owner, LOCKED): "Potential value" = what this opportunity could be worth IF it converts. It is not
// revenue and is never called earnings (guarded). Computed ONLY from the request's own explicit data: the party size
// the customer gave times the per-person budget the customer stated, worded "up to" because a budget is a ceiling.
// Never from the business's general pricing (typical spend, price tier, minimum spend) or a category guess; missing
// either input = null (no line, never "$0"). Informational only: nothing that ranks, routes, decides eligibility,
// picks offers or places sponsored items may read it (guarded in potentialValue.test.js).
export function potentialValue(req) {
  const r = req ?? {};
  const people = Number(r.party_size);
  const budget = Number(r.budget_max);
  if (!Number.isInteger(people) || people < 1) return null;
  if (r.budget_max == null || !(budget > 0)) return null;
  const amount = Math.round(budget * people * 100) / 100;
  return {
    amount,
    line: P('potentialValueUpTo', { amount: bizMoney(amount) }),
    basis: P('potentialBasisBudget', { people: P('people', { count: people }), amount: bizMoney(budget) }),
    note: P('potentialNote'),
  };
}

// "Why this matches": the trust line on a pending opportunity. Every line traces to a real scoring reason (or, for the
// area line, to the fact that fan-out only reaches businesses inside the request's radius). Nothing is invented: a
// signal that did not fire simply does not appear, and with no reasons the card falls back to "New opportunity".
// Price fit is real now that budget_max is locked as per person (see budgetTier.js): it fires only when the request's
// per-person budget >= the business's own active per-person minimum spend. The availability line is real but narrow: it only appears when the business has an
// ACTIVE posted slot (business_availability) covering the request's date/time -- there are no standing opening hours.
// ctx.occasion = the occasion's name in the viewer's language (English lowercased, as before), or null.
const REASON_LINES = {
  offered_occasion: (ctx) => (ctx.occasion ? P('reason.offeredOccasion', { occasion: ctx.occasion }) : P('reason.offeredThisOccasion')),
  want_occasion: (ctx) => (ctx.occasion ? P('reason.wantOccasion', { occasion: ctx.occasion }) : P('reason.wantRequestsLikeThis')),
  priority_attribute: () => P('reason.priorityAttribute'),
  offers_attribute: () => P('reason.offersAttribute'),
  cuisine: () => P('reason.cuisine'),
  dietary: () => P('reason.dietary'),
  party_size: () => P('reason.partySize'),
  time_window: () => P('reason.timeWindow'),
  weekday: () => P('reason.weekday'),
  last_minute: () => P('reason.lastMinute'),
  large_group: () => P('reason.largeGroup'),
  boost: () => P('reason.boost'),
};
const REASON_ORDER = ['offered_occasion', 'want_occasion', 'priority_attribute', 'offers_attribute', 'cuisine', 'dietary', 'party_size', 'time_window', 'weekday', 'last_minute', 'large_group', 'boost'];

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

// occasion: the occasion's name as it reads inside a sentence ("birthday"); the wording around it comes from the key.
export function buildMatchReasons(reasons = [], { occasion = null, hasAvailability = false, priceFits = false, directed = false } = {}) {
  const keys = new Set((reasons ?? []).map((r) => r.key));
  // A host who picked THIS business (business_request_offers.is_directed) is the strongest, real reason there is.
  const lines = (directed ? [P('reason.directed')] : []).concat(REASON_ORDER.filter((k) => keys.has(k)).map((k) => REASON_LINES[k]({ occasion })));
  if (priceFits) lines.push(P('reason.priceFits'));
  if (hasAvailability) lines.push(P('reason.hasAvailability'));
  // Fan-out only creates an opportunity for a business inside the request's radius, so this is true by construction.
  // (A directed ask named this business, not an area, so the line does not apply.)
  if (!directed) lines.push(P('reason.inArea'));
  return directed || lines.length > 1 ? lines : [];
}
