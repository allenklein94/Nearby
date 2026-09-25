// Fitting a multi-part plan into the time the person has (item 68 follow-up, 2026-09-25). "Dinner and a movie, I have 3 hours."
// Input: the assembled Experience (utils/experienceAssembly.js) and a budget in minutes from the person's OWN words (a stated
// amount, or the span of "between 2 and 5 PM"). Each part's length is its lead item's `lengthOf` (host-declared, else the
// category's usual length); a part with no known length counts as unknown, never as zero-and-fine.
// Steps, deterministic: (1) if the plan runs over, each part leads with its SHORTEST known-length option among the ones already
// shown (a reorder; nothing is hidden), (2) if it still runs over, the LAST parts are left out of the plan, one at a time, while
// at least two parts remain; they stay in the flat results and the caption names them; (3) the plan carries a `timing` line.
// No travel time between stops is added (nothing measures it), so the line says "usually about", never an exact itinerary.
// No budget = the Experience is returned unchanged.
import { lengthOf, TIME_SLACK } from '../constants/timeBudget';

export function planDurationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.max(15, Math.round(minutes / 15) * 15);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function budgetPhrase(budget) {
  if (budget === 60) return 'your hour';
  if (budget === 30) return 'your half hour';
  if (budget % 60 === 0) return `your ${budget / 60} hours`;
  return `your ${planDurationLabel(budget)}`;
}

// { minutes, unknown } for the lead items of the given components.
export function planLength(components) {
  let minutes = 0;
  let unknown = 0;
  for (const c of components) {
    const len = lengthOf(c.items?.[0]);
    if (len) minutes += len.minutes; else unknown += 1;
  }
  return { minutes, unknown };
}

const over = (minutes, budget) => minutes > budget * TIME_SLACK;
// Honest wording in three bands: within the budget, a little over (inside the rounding slack), clearly over.
function fitWords(minutes, budget) {
  if (minutes <= budget) return ` · fits ${budgetPhrase(budget)}`;
  if (!over(minutes, budget)) return `, a little over ${budgetPhrase(budget)}`;
  return `, more than ${budgetPhrase(budget)}`;
}

function leadShortest(component) {
  const known = component.items.map((item, index) => ({ item, index, len: lengthOf(item)?.minutes ?? null })).filter((x) => x.len != null);
  if (known.length === 0) return component;
  const shortest = known.reduce((a, b) => (b.len < a.len ? b : a));
  const leadLen = lengthOf(component.items[0])?.minutes ?? null;
  if (shortest.index === 0 || (leadLen != null && leadLen <= shortest.len)) return component;
  const items = [shortest.item, ...component.items.filter((_, i) => i !== shortest.index)];
  return { ...component, items };
}

export function fitExperienceToTime(experience, budget) {
  if (!experience || !Array.isArray(experience.components) || !Number.isFinite(budget) || budget <= 0) return experience;
  let components = experience.components;
  if (over(planLength(components).minutes, budget)) components = components.map(leadShortest);
  const leftOut = [];
  while (components.length > 2 && over(planLength(components).minutes, budget)) {
    leftOut.unshift(components[components.length - 1].label);
    components = components.slice(0, -1);
  }
  const { minutes, unknown } = planLength(components);
  const fits = !over(minutes, budget);
  let line = null;
  if (minutes > 0) {
    const total = `Usually about ${planDurationLabel(minutes)}${unknown ? ' for the parts we know' : ''}`;
    line = `${total}${fitWords(minutes, budget)}`;
  }
  const leftOutLine = leftOut.length ? `Left out ${leftOut.join(' and ')} to fit ${budgetPhrase(budget)}` : null;
  return { ...experience, components, timing: { budget, minutes, unknownParts: unknown, fits, leftOut, line, leftOutLine } };
}

// The person's own picks ("+ Add to your night"): their usual total, for the line beside "Plan this night".
export function picksLengthLine(items, budget) {
  if (!Array.isArray(items) || items.length < 2) return null;
  let minutes = 0;
  let unknown = 0;
  for (const it of items) { const len = lengthOf(it); if (len) minutes += len.minutes; else unknown += 1; }
  if (minutes <= 0) return null;
  const base = `Your picks: usually about ${planDurationLabel(minutes)}${unknown ? ' for the parts we know' : ''}`;
  if (!Number.isFinite(budget) || budget <= 0) return base;
  return `${base}${fitWords(minutes, budget)}`;
}
