// Fitting a multi-part plan into the time the person has (item 68, owner decision 2026-09-25, LOCKED). "Dinner and a movie,
// I have 3 hours." ONE duration system: each part's length is its lead item's `lengthOf` (host-declared, else the category's
// usual length, constants/timeBudget.js); the plan's total is their sum, an APPROXIMATE planning estimate, always worded
// "usually about ... in total (an estimate)", never a promise. The budget comes only from the person's words: an amount they
// said they have, or the length of an anchored clock range ("tonight between 6 and 8 PM"); never from a start time or the clock.
// Ranking only, never a filter: when the plan runs over, each part leads with its shortest known-length option among the ones
// already shown, so the combination that fits moves up; every part and every option stays. A part with no known length is
// NEVER given one: the total is marked incomplete ("for the parts we know") and cannot be called a fit on its own.
// No travel time between stops is added (nothing measures it). No budget = the Experience is returned unchanged.
import { lengthOf, TIME_SLACK, timePhrase } from '../constants/timeBudget';

export function planDurationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.max(15, Math.round(minutes / 15) * 15);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
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

// 'fits' | 'a_little_over' | 'over' | 'unknown'. An incomplete total already over is over; an incomplete total under the
// budget is 'unknown' (the missing part could take any time).
export function planFitStatus(minutes, unknown, budget) {
  if (minutes <= 0) return 'unknown';
  if (over(minutes, budget)) return 'over';
  if (minutes > budget) return 'a_little_over';
  return unknown ? 'unknown' : 'fits';
}

// "your hour", "your hour and a half", "your 2 hours".
function yourTime(budget) {
  if (budget === 60) return 'your hour';
  if (budget === 30) return 'your half hour';
  if (budget === 90) return 'your hour and a half';
  return `your ${timePhrase(budget)}`;
}

function fitWords(status, budget, span) {
  const target = span ? `between ${span}` : yourTime(budget);
  if (status === 'fits') return span ? ` · fits ${target}` : ` · fits in ${target}`;
  if (status === 'a_little_over') return `, a little over ${target}`;
  if (status === 'over') return `, more than ${target}`;
  return ` · may fit ${target}`;
}

function leadShortest(component) {
  const known = component.items.map((item, index) => ({ item, index, len: lengthOf(item)?.minutes ?? null })).filter((x) => x.len != null);
  if (known.length === 0) return component;
  const shortest = known.reduce((a, b) => (b.len < a.len ? b : a));
  const leadLen = lengthOf(component.items[0])?.minutes ?? null;
  if (shortest.index === 0 || (leadLen != null && leadLen <= shortest.len)) return component;
  return { ...component, items: [shortest.item, ...component.items.filter((_, i) => i !== shortest.index)] };
}

// `spanLabel` (optional): "6 PM and 8 PM" when the budget is an anchored clock range, so the line names the window, not an amount.
export function fitExperienceToTime(experience, budget, spanLabel = null) {
  if (!experience || !Array.isArray(experience.components) || !Number.isFinite(budget) || budget <= 0) return experience;
  let components = experience.components;
  if (over(planLength(components).minutes, budget)) components = components.map(leadShortest);
  const { minutes, unknown } = planLength(components);
  const status = planFitStatus(minutes, unknown, budget);
  const line = minutes > 0
    ? `Usually about ${planDurationLabel(minutes)} in total${unknown ? ' for the parts we know' : ''} (an estimate)${fitWords(status, budget, spanLabel)}`
    : null;
  return { ...experience, components, timing: { budget, minutes, unknownParts: unknown, complete: unknown === 0, status, line } };
}

// The person's own picks ("+ Add to your night"): their approximate total, beside "Plan this night".
export function picksLengthLine(items, budget) {
  if (!Array.isArray(items) || items.length < 2) return null;
  let minutes = 0;
  let unknown = 0;
  for (const it of items) { const len = lengthOf(it); if (len) minutes += len.minutes; else unknown += 1; }
  if (minutes <= 0) return null;
  const base = `Your picks: usually about ${planDurationLabel(minutes)}${unknown ? ' for the parts we know' : ''}`;
  if (!Number.isFinite(budget) || budget <= 0) return base;
  return `${base}${fitWords(planFitStatus(minutes, unknown, budget), budget, null)}`;
}
