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
