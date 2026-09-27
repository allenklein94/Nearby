import { INTEREST_OPTIONS } from './gatheringCategories';
import { ONBOARDING_INTEREST_GROUPS } from './interestGraph';
import { searchScope } from './categoryTree';

// Onboarding asks about interests lightly (owner item 94): "What are you into? Choose a few" from a short list, then an
// optional "Anything else?" in the person's own words. Nothing new is stored: every pick maps onto the ONE taxonomy as
// canonical leaf tags (-> monthly_interests, then profiles.interests) and, where a pick is really a whole area, a broad
// interest group (-> interest_groups, the weak 2-point signal). The long tail stays reachable through the free text and
// Settings; onboarding never shows every tag.
export const QUICK_INTERESTS = [
  { key: 'coffee', icon: '☕', label: 'Coffee', tags: ['Coffee'] },
  { key: 'fitness', icon: '🏃', label: 'Fitness', tags: ['Fitness'] },
  { key: 'live_music', icon: '🎵', label: 'Live Music', tags: ['Live Music'] },
  { key: 'restaurants', icon: '🍝', label: 'Restaurants', tags: ['Restaurants'] },
  { key: 'outdoors', icon: '🏖️', label: 'Outdoors', tags: ['Outdoors'], group: 'outdoors_nature' },
  { key: 'arts', icon: '🎨', label: 'Arts', tags: ['Art'], group: 'arts_culture_learning' },
  { key: 'sports', icon: '⚽', label: 'Sports', tags: ['Sports'] },
  { key: 'nightlife', icon: '🍸', label: 'Nightlife', tags: ['Bars & Lounges', 'Happy Hour'] },
  { key: 'games', icon: '🎲', label: 'Games', tags: ['Gaming', 'Board Games'] },
  { key: 'yoga', icon: '🧘', label: 'Yoga', tags: ['Yoga'] },
  { key: 'dogs', icon: '🐕', label: 'Dogs', tags: ['Dogs'] },
];

const CONSUMER_TAGS = new Set(INTEREST_OPTIONS);

// The quick picks' tags, flat and deduped (the account step's short list).
export const QUICK_INTEREST_TAGS = [...new Set(QUICK_INTERESTS.flatMap((q) => q.tags))].filter((t) => CONSUMER_TAGS.has(t));
const ONBOARDING_GROUPS = new Set(ONBOARDING_INTEREST_GROUPS.map((g) => g.key));

// Quick picks -> { tags, groups }, deduped, in list order.
export function quickPicksToTaxonomy(keys) {
  const picked = new Set(keys ?? []);
  const tags = [];
  const groups = [];
  for (const q of QUICK_INTERESTS) {
    if (!picked.has(q.key)) continue;
    for (const t of q.tags) if (CONSUMER_TAGS.has(t) && !tags.includes(t)) tags.push(t);
    if (q.group && ONBOARDING_GROUPS.has(q.group) && !groups.includes(q.group)) groups.push(q.group);
  }
  return { tags, groups };
}

const FILLER = /^(i\s+(really\s+)?(like|love|enjoy)|i'?m\s+(into|a\s+fan\s+of)|into|also|maybe|some|lots?\s+of)\s+/i;

// "Anything else?" -> { tags, groups, unmatched } through the canonical resolver (synonyms, tags, group names).
// Deterministic, never AI. Only CONSUMER tags (business-only tags such as Dental never become a personal interest) and
// real onboarding groups are kept. A cuisine is not an interest (item 76), so "Italian" is reported as unmatched rather
// than turned into something it is not. The person sees exactly what was understood before it is saved.
export function mapAnythingElse(text) {
  const parts = String(text ?? '')
    .split(/[,;\n/]+|\s+\band\b\s+|\s+\+\s+/i)
    .map((p) => p.trim().replace(FILLER, '').replace(/[.!?]+$/, '').trim())
    .filter((p) => p.length >= 2);
  const tags = [];
  const groups = [];
  const unmatched = [];
  for (const part of parts) {
    const scope = searchScope(part);
    let hit = false;
    if (scope.level === 'tag') {
      for (const t of scope.tags) if (CONSUMER_TAGS.has(t) && !tags.includes(t)) { tags.push(t); hit = true; }
      if (scope.tags.some((t) => CONSUMER_TAGS.has(t))) hit = true;
    } else if (scope.level === 'group' && ONBOARDING_GROUPS.has(scope.group)) {
      if (!groups.includes(scope.group)) groups.push(scope.group);
      hit = true;
    }
    if (!hit && !unmatched.includes(part)) unmatched.push(part);
  }
  return { tags, groups, unmatched };
}

// Everything onboarding saves: quick picks + the confirmed free text, merged and deduped.
export function onboardingInterestSelection(quickKeys, anythingElseText) {
  const a = quickPicksToTaxonomy(quickKeys);
  const b = mapAnythingElse(anythingElseText);
  return {
    tags: [...new Set([...a.tags, ...b.tags])],
    groups: [...new Set([...a.groups, ...b.groups])],
    unmatched: b.unmatched,
  };
}

// ---- In-progress onboarding across the upgrade (owner, item 94 follow-up) ----
// The old flow's draft (pending_onboarding_questions_draft) held { goals, lookingFor, comfortLevel, groupKeys, tags }.
// Nothing a person already chose may be dropped when the new screen reads it: goals / looking-for / comfort carry over
// as-is; an old tag that IS a whole quick pick (Coffee, Yoga...) turns that pick on; every other old tag and every old
// group stays as an "earlier" selection, shown as a removable chip and saved exactly as the old flow would have.
// A new-format draft (v: 2) reads back unchanged.
export const ONBOARDING_DRAFT_VERSION = 2;

export function migrateOnboardingDraft(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const base = {
    goals: Array.isArray(d.goals) ? d.goals : [],
    lookingFor: typeof d.lookingFor === 'string' ? d.lookingFor : null,
    comfortLevel: typeof d.comfortLevel === 'string' ? d.comfortLevel : null,
  };
  const validQuick = new Set(QUICK_INTERESTS.map((q) => q.key));
  if (d.v === ONBOARDING_DRAFT_VERSION) {
    return {
      ...base,
      quickKeys: (Array.isArray(d.quickKeys) ? d.quickKeys : []).filter((k) => validQuick.has(k)),
      anythingElse: typeof d.anythingElse === 'string' ? d.anythingElse : '',
      excluded: Array.isArray(d.excluded) ? d.excluded : [],
      earlierTags: (Array.isArray(d.earlierTags) ? d.earlierTags : []).filter((t) => CONSUMER_TAGS.has(t)),
      earlierGroups: (Array.isArray(d.earlierGroups) ? d.earlierGroups : []).filter((g) => ONBOARDING_GROUPS.has(g)),
      earlierOff: Array.isArray(d.earlierOff) ? d.earlierOff : [],
    };
  }
  // Old format (no version).
  const oldTags = [...new Set((Array.isArray(d.tags) ? d.tags : []).filter((t) => CONSUMER_TAGS.has(t)))];
  const quickKeys = QUICK_INTERESTS.filter((q) => q.tags.length === 1 && !q.group && oldTags.includes(q.tags[0])).map((q) => q.key);
  const covered = new Set(quickPicksToTaxonomy(quickKeys).tags);
  return {
    ...base,
    quickKeys,
    anythingElse: '',
    excluded: [],
    earlierTags: oldTags.filter((t) => !covered.has(t)),
    earlierGroups: [...new Set((Array.isArray(d.groupKeys) ? d.groupKeys : []).filter((g) => ONBOARDING_GROUPS.has(g)))],
    earlierOff: [],
  };
}

// Exactly what onboarding saves: quick picks + kept earlier selections + kept words. Removing a chip removes only that
// source's contribution (a quick pick stays picked even if the words named the same tag).
export function savedOnboardingInterests({ quickKeys = [], anythingElse = '', excluded = [], earlierTags = [], earlierGroups = [], earlierOff = [] } = {}) {
  const quick = quickPicksToTaxonomy(quickKeys);
  const extra = mapAnythingElse(anythingElse);
  return {
    tags: [...new Set([
      ...quick.tags,
      ...earlierTags.filter((t) => !earlierOff.includes(t)),
      ...extra.tags.filter((t) => !excluded.includes(t)),
    ])],
    groups: [...new Set([
      ...quick.groups,
      ...earlierGroups.filter((g) => !earlierOff.includes(g)),
      ...extra.groups.filter((g) => !excluded.includes(g)),
    ])],
  };
}
