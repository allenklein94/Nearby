// Don't make people think in categories (owner item 63, 2026-09-25). "I want something fun with my wife tonight, maybe dinner
// and something to do after" is ONE plan with two parts, not a choice between Food & Drink and Activities. This module reads,
// deterministically from the person's own words (never AI), whether an ask names two or more PARTS of an outing; the intent
// resolver then stops narrowing to a single category (which silently dropped every part but one) and lets the existing
// cross-category recipes (constants/experienceTemplates.js, "Make it a night") assemble the combined plan from real nearby
// supply. Nothing is invented: a part with no real supply is dropped by assembleExperience as before, and a plan still needs
// a planning window (tonight / today / tomorrow / weekend) the person actually gave.

import { tagsInText } from '../constants/categorySynonyms';
import { canonicalGroupForTag } from '../constants/categoryMapping';
import { ALCOHOL_TAGS } from '../constants/askFacets';

// The parts of an outing, in the order they are usually done. First regex that matches a part wins; the order of the
// person's own words decides the order shown.
const PARTS = [
  { key: 'food', label: 'dinner', re: /\b(dinner|lunch|brunch|breakfast|eat|eating|food|a\s+bite|restaurant|supper)\b/i },
  { key: 'activity', label: 'something to do', re: /\bsomething\s+(to\s+do|fun)\b|\b(an?\s+)?(activity|show|movie|concert|comedy|game|bowling|museum|walk|play)\b/i },
  { key: 'drinks', label: 'drinks', re: /\b(drinks?|cocktails?|a\s+bar|wine|beers?)\b/i },
  { key: 'dessert', label: 'dessert', re: /\b(dessert|ice\s+cream|gelato|something\s+sweet)\b/i },
];

// Item 130: a thing-to-do the person NAMES by its canonical tag ("live music", "mini golf", "dancing", "escape room") is the
// activity part too, so the taxonomy keeps this current instead of a word list. Drink tags stay the drinks part (never both).
// Not a part: a tag that says WHERE ("dinner near the park", "lunch at a museum cafe") and 'Outdoors', which is the
// environment facet (askFacets, item 103), not a thing to do.
const PLACE_WORD = /(^|\s)(near|by|at|in|around|beside|behind|inside|outside)(\s(the|a|an|my|our|this|that))?$/;
const NOT_A_PART = new Set(['Outdoors']);
// How far / how they get there is never an activity ("walking distance", "on my bike", "I'm driving": items 69/70).
const TRAVEL_WORDS = /\bwalk(?:ing|able)?\s+distance\b|\bwithin\s+(?:a\s+)?walk(?:ing)?\b|\bwalk(?:ing)?\s+(?:there|over|from)\b|\bwalkable\b|\bon\s+(?:my|a|our)\s+bikes?\b|\bby\s+(?:bike|car|bus|train)\b|\bbik(?:e|ing)\s+(?:there|over)\b|\b(?:i'?m|we'?re|i\s+am|we\s+are)\s+(?:driving|walking|biking)\b|\b(?:a\s+)?short\s+drive\b|\bworth\s+the\s+drive\b/gi;
const ACTIVITY_GROUPS = new Set(['activities_recreation', 'entertainment_nightlife', 'arts_culture_learning', 'outdoors_nature', 'attractions_things_to_see', 'family_kids']);

// Explicit occasion words the person used. Deterministic; only these, never a guess from the category. Item 130 added the
// unambiguous event words (graduation, baby shower, housewarming, bachelor(ette), engagement party, going-away party).
const OCCASION_WORDS = [
  ['first_date', /\bfirst\s+date\b/i],
  ['date_night', /\bdate\s+night\b/i],
  ['anniversary', /\banniversary\b/i],
  ['baby_shower', /\bbaby\s+shower\b/i],
  ['bachelor_bachelorette', /\bbachelor(ette)?\s+part(y|ies)\b|\bhen\s+(party|do)\b|\bstag\s+(party|do)\b/i],
  ['graduation', /\bgraduation\b|\bgrad\s+party\b/i],
  ['housewarming', /\bhouse\s?warming\b/i],
  ['engagement', /\bengagement\s+(party|dinner|celebration)\b/i],
  ['farewell', /\b(farewell|going[- ]away)\s+(party|dinner|drinks|lunch)\b/i],
  ['birthday', /\bbirthday\b/i],
];

const EVENING = /\b(tonight|tonite|this\s+evening|evening|night)\b/i;

export function planParts(text) {
  const t = String(text ?? '');
  const found = [];
  for (const p of PARTS) {
    const m = t.match(p.re);
    if (m) found.push({ key: p.key, label: p.key === 'food' ? m[0].toLowerCase().replace(/^(a|an)\s+/, '') : p.label, at: m.index });
  }
  if (!found.some((p) => p.key === 'activity')) {
    const named = tagsInText(t.replace(TRAVEL_WORDS, ' ')).find(({ tag, prev }) => ACTIVITY_GROUPS.has(canonicalGroupForTag(tag)) && !ALCOHOL_TAGS.includes(tag) && !NOT_A_PART.has(tag) && !PLACE_WORD.test(prev));
    if (named) {
      const at = t.toLowerCase().search(new RegExp(`\\b${named.word}`));
      found.push({ key: 'activity', label: 'something to do', at: at >= 0 ? at : t.length });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ key, label }) => ({ key, label }));
}

// null unless the ask names at least two different parts of an outing.
export function planAsk(text) {
  const parts = planParts(text);
  return parts.length >= 2 ? { parts } : null;
}

// The occasion the person's words say. A couple planning a multi-part EVENING with no occasion word is a date night (the owner's
// example); anything else without an explicit word stays null.
export function occasionFromAsk(text, { partyType = null, dateWindow = null } = {}) {
  const t = String(text ?? '');
  for (const [key, re] of OCCASION_WORDS) if (re.test(t)) return key;
  if (partyType === 'date' && planAsk(t) && (dateWindow === 'tonight' || EVENING.test(t))) return 'date_night';
  return null;
}

// Which recipe a multi-part ask uses is decided by constants/planCombinations.js (recognizeCombination), the one table.

const OCCASION_LABEL = { date_night: 'a date night', first_date: 'a first date', anniversary: 'an anniversary', birthday: 'a birthday' };
const WHEN_LABEL = { tonight: 'tonight', today: 'today', tomorrow: 'tomorrow', weekend: 'this weekend' };

// One line saying what Nearby understood, so the person sees their plan, not a category: "Planning a date night tonight:
// dinner, then something to do". null when the ask is not a multi-part plan.
export function planCaption(text, { occasion = null, dateWindow = null } = {}) {
  const plan = planAsk(text);
  if (!plan) return null;
  const what = OCCASION_LABEL[occasion] ?? 'your plan';
  const when = WHEN_LABEL[dateWindow] ? ` ${WHEN_LABEL[dateWindow]}` : '';
  return `Planning ${what}${when}: ${plan.parts.map((p) => p.label).join(', then ')}`;
}
