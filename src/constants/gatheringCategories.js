// The single canonical source of truth for "what kind of gathering/
// community/business-request is this" -- see CLAUDE.md's "Category/filter
// taxonomy pass" section for the full design discussion. This same 25-tag
// list used to be duplicated verbatim, independently, across 8 separate
// files -- already caught drifting once (CreateGatheringScreen's own copy
// was missing "Faith & Spirituality"). Every file that represents "what
// kind of event/activity is this" (gatherings, communities, business
// requests/availability, Quick Picks) should import from here instead of
// keeping its own copy. Deliberately NOT used by ProfileScreen/
// CompleteProfileScreen's personal-interest pickers -- "what am I into" is
// a different semantic than "what kind of event is this," and "Dating"
// reads oddly as a personal interest tag next to Coffee/Hiking.
//
// "Dating" is the one new tag added this pass (of the ~20 the original
// external proposal named) -- the one whole group with zero existing
// coverage, despite Dating being one of this app's two core matching
// systems. Every other proposed leaf tag (Cycling, Bars, Games, Trivia,
// Comedy, etc.) maps reasonably onto an existing tag already covering the
// same real activity -- adding a same-meaning tag twice, each needing its
// own icon/color/(ideally) verified cover photo to match the bar every
// existing tag already has, was judged not worth the drop in polish a
// rushed batch would mean. The group structure below is ready to receive
// more tags later if genuinely wanted.
export const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running', 'Faith & Spirituality', 'Dating',
];

// The single shared list for "what am I into" (personal interests, edited
// on Profile/CompleteProfile) — deliberately distinct from INTEREST_OPTIONS
// above per this file's own documented reasoning (a different semantic
// than "what kind of event is this," and "Dating" reads oddly as a
// personal interest next to Coffee/Hiking), but it's still ONE shared list,
// not two independently-typed copies. ProfileScreen.js and
// CompleteProfileScreen.js used to each keep their own hand-typed 24-tag
// copy of this — both were independently missing "Faith & Spirituality"
// (the taxonomy audit, 2026-08-24, found this as a real live bug: a user
// could not select it as a personal interest anywhere in the app, even
// though it's a fully real tag everywhere else). Fixed by deriving this
// from the canonical list once, here, so the two can never drift again.
export const PERSONAL_INTEREST_OPTIONS = INTEREST_OPTIONS.filter((tag) => tag !== 'Dating');

// Every one of the 26 tags above lives in exactly one group -- none left
// ungrouped, none duplicated. A real, defensible grouping of what already
// exists, not a from-scratch taxonomy replacement.
export const CATEGORY_GROUPS = [
  { key: 'active', icon: '💪', label: 'Active', tags: ['Fitness', 'Sports', 'Running', 'Hiking', 'Outdoors', 'Yoga'] },
  { key: 'social', icon: '🎉', label: 'Social', tags: ['Coffee', 'Foodie', 'Wine', 'Gaming', 'Dancing'] },
  { key: 'entertainment', icon: '🎭', label: 'Entertainment', tags: ['Music', 'Movies', 'Concerts', 'Museums', 'Photography', 'Art'] },
  { key: 'lifestyle', icon: '🌿', label: 'Lifestyle', tags: ['Reading', 'Cooking', 'Travel', 'Meditation', 'Dogs', 'Cats'] },
  { key: 'community', icon: '🤝', label: 'Community', tags: ['Volunteering', 'Faith & Spirituality'] },
  { key: 'dating', icon: '💗', label: 'Dating', tags: ['Dating'] },
];

export function groupForTag(tag) {
  return CATEGORY_GROUPS.find((g) => g.tags.includes(tag)) ?? null;
}
