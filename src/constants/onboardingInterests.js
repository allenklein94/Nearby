import { INTEREST_OPTIONS } from './gatheringCategories';
import { ONBOARDING_INTEREST_GROUPS } from './interestGraph';
import { searchScope } from './categoryTree';
import { tagsInText } from './categorySynonyms';

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
  const addTag = (t) => { if (CONSUMER_TAGS.has(t) && !tags.includes(t)) tags.push(t); };
  const addUnmatched = (w) => { if (w && !unmatched.includes(w)) unmatched.push(w); };
  for (const part of parts) {
    const scope = searchScope(part);
    if (scope.level === 'group' && ONBOARDING_GROUPS.has(scope.group)) {
      if (!groups.includes(scope.group)) groups.push(scope.group);
      continue;
    }
    if (scope.level === 'tag' && scope.tags.some((t) => CONSUMER_TAGS.has(t))) {
      // Owner, 2026-11-22: an entry typed without commas ("pickleball hockey board games") used to keep only its first
      // match and drop the rest without a word. Every activity named in the entry now counts, and every word left over is
      // shown under "Not matched yet". An entry fully explained by its matches keeps exactly the old result.
      const { hits, leftover } = entryCoverage(part);
      if (leftover.length === 0 && hits.length <= 1) {
        scope.tags.forEach(addTag);
      } else {
        hits.forEach(addTag);
        if (!hits.some((t) => CONSUMER_TAGS.has(t))) scope.tags.forEach(addTag);
        leftover.forEach(addUnmatched);
      }
      continue;
    }
    addUnmatched(part);
  }
  return { tags, groups, unmatched };
}

// Small words that carry no interest of their own ("and", "i like"), never reported as unmatched.
const GLUE_WORDS = new Set(['and', 'or', 'i', 'me', 'my', 'like', 'love', 'enjoy', 'also', 'too', 'the', 'a', 'an', 'some', 'with',
  'plus', 'of', 'to', 'really', 'into', 'stuff', 'thing', 'things', 'etc', 'lot', 'lots', 'more', 'other']);

// The tags every whole-word phrase in one entry names (the one phrase matcher, tagsInText) + the runs of words no phrase
// covers, in the person's words (lowercased), glue words dropped.
function entryCoverage(part) {
  const words = String(part).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const found = tagsInText(part);
  const covered = new Set();
  for (const f of found) for (let i = 0; i < (f.len ?? 1); i++) covered.add(f.start + i);
  const leftover = [];
  let run = [];
  const flush = () => {
    const phrase = trimGlue(run.join(' '));
    if (phrase) leftover.push(phrase);
    run = [];
  };
  words.forEach((w, i) => { if (covered.has(i)) flush(); else run.push(w); });
  flush();
  // A format/setting word ("class", "outdoor") names a category only when nothing concrete is named, as in tagsForPhrase.
  const concrete = found.filter((f) => !f.generic);
  return { hits: [...new Set((concrete.length ? concrete : found).map((f) => f.tag))], leftover };
}

const trimGlue = (phrase) => {
  const w = phrase.split(' ');
  while (w.length && GLUE_WORDS.has(w[0])) w.shift();
  while (w.length && GLUE_WORDS.has(w[w.length - 1])) w.pop();
  return w.join(' ');
};

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
