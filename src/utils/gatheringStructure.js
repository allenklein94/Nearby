// Owner item 64: a gathering is created from STRUCTURED facts, not inferred from its title. The Create flow already captures
// What (title + category), When, Where, Who (visibility), Group size (capacity), Public/private, Join approval, Business help
// and Notes. The one that was optional -- and that every downstream system reads (Interested demand, the business request's
// category and category-aware routing, recommendations, weather relevance, "Because you like") -- is the CATEGORY. 5 of 25
// production gatherings had none. It is now required, with one tap on the What step.
import { groupForTag } from '../constants/gatheringCategories';

// -> 'title' | 'category' | null (the first thing missing on the What step)
export function whatStepProblem({ title, interestTag }) {
  if (!String(title ?? '').trim()) return 'title';
  if (!interestTag || !groupForTag(interestTag)) return 'category';
  return null;
}

// A quick-pick may skip the What step only when it already carries BOTH a title and a real category.
export function canSkipWhatStep(params) {
  return !!params?.fromQuickPick && whatStepProblem({ title: params?.quickStartTitle, interestTag: params?.quickStartCategory }) === null;
}

// Item 61: the host's own words already gave a title AND a real category, so the flow STARTS after the What step (it stays
// in the flow, one Back away, to change either). A quick-pick removes the step instead (canSkipWhatStep).
export function startAfterWhatStep(params) {
  return !!params?.inferredFromText && !canSkipWhatStep(params) && whatStepProblem({ title: params?.quickStartTitle, interestTag: params?.quickStartCategory }) === null;
}

// Item 65: the gathering's WHEN as the host's own local wall-clock date ('YYYY-MM-DD') and start time ('HH:MM:SS'), which the
// business request stores as structured fields (the server cannot know the device timezone). null for an unusable date.
export function localWhenParts(scheduledAt) {
  const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}:00`,
  };
}

// "Planning for 4?": a headcount Nearby read from what the person said becomes a SUGGESTED capacity chip (never a
// silent commit: the Settings step says so and the chip stays editable). Maps onto the existing chips only -- 2-4, 5-10,
// or 10+ with the number as the stepper default. A headcount of 1, or anything unreadable, suggests nothing.
export function capacityForPartySize(n) {
  const size = Number(n);
  if (!Number.isInteger(size) || size < 2 || size > 200) return null;
  if (size <= 4) return { option: '2-4', custom: 15, size };
  if (size <= 10) return { option: '5-10', custom: 15, size };
  return { option: '10+', custom: size, size };
}
