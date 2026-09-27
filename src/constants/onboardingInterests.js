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
