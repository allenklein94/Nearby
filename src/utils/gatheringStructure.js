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
