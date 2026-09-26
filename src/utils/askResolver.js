// The one structured understanding of an ask (owner items 60-63, continued 2026-09-25). "Rich internal understanding ->
// minimal contextual UI": every free-text entry point (Home, Discover, Celebrate, Create) gets the SAME structured result from
// `resolveAsk`, shaped by the item-60 ontology, and each surface shows only what is useful in context.
//
// Rules (owner, LOCKED):
//  1. Existing vocabularies only (tags/groups, party types, occasions, attributes, activities, time buckets). Nothing new.
//  2. The person's own words are read by deterministic rules (gatheringInference, planAsk, askFacets, activityLayer...).
//  3. The AI may ENHANCE classification (category, cuisine, attributes, title, intent), but a FACT it returns is kept only
//     when the words support it: time, occasion, group, party size and budget are checked here; unsupported = dropped.
//  4. With no AI (service down), the same rules produce the best valid result, so behavior only gains, never changes shape.
//  5. Missing stays missing (null / []), never guessed.
//  6. Time is ONLY from explicit words. A combined/scheduled plan needs one (item 63 decision).
// Pure: no network, no AI, no storage.
import { canonicalGroupForTag } from '../constants/categoryMapping';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { OCCASION_OPTIONS } from '../constants/businessAttributes';
import { activitiesFromText } from '../constants/activityLayer';
import { attributesFromAsk, parseAskFacets } from '../constants/askFacets';
import { energiesFromText } from '../constants/energyLevel';
import { commitmentAsk } from '../constants/commitmentLevel';
import { spontaneityOf } from '../constants/spontaneity';
import { tagsForPhrase } from '../constants/categorySynonyms';
import { groupFromText, whenPresetFromText, partySizeFromText, titleFromText, inferredSummary } from './gatheringInference';
import { planAsk, occasionFromAsk } from './planAsk';
import { recognizeCombination } from '../constants/planCombinations';
import { formatsFromText } from '../constants/activityFormat';
import { skillLevelsFromText } from '../constants/skillLevel';
import { genresFromText } from '../constants/genreMatch';
import { intensityFromText, effortFromText } from '../constants/intensityEffort';
import { socialSignalsFromText } from '../constants/socialContext';
import { distanceWillingnessFromText } from '../constants/distanceWillingness';
import { transportModeFromText } from '../constants/transportMode';
import { timeBudgetFromText } from '../constants/timeBudget';
import { clockWindowFromText, dateAnchorFromText } from '../constants/clockWindow';
import { cuisineFromText } from '../constants/categoryTree';

// ---- time: explicit words only (the classifier's own buckets) ----
export function dateWindowFromText(text) {
  const t = String(text ?? '');
  if (/\b(right\s+now|right\s+away|immediately|asap|as\s+soon\s+as\s+possible|now)\b/i.test(t)) return 'now';
  if (/\b(tonight|tonite|this\s+evening)\b/i.test(t)) return 'tonight';
  if (/\btomorrow\b/i.test(t)) return 'tomorrow';
  // "next weekend" has no defined meaning in this product, so it is not read as this weekend.
  if (/\bnext\s+weekend\b/i.test(t)) return null;
  if (/\b(this\s+weekend|weekend|saturday|sunday)\b/i.test(t)) return 'weekend';
  if (/\btoday\b/i.test(t)) return 'today';
  return null;
}

// ---- budget: explicit words only ----
export function priceLevelFromText(text) {
  const t = String(text ?? '');
  if (/\b(free|no\s+cost)\b/i.test(t)) return 'free';
  if (/\b(cheap|inexpensive|budget[- ]friendly|on\s+a\s+budget|affordable)\b/i.test(t)) return '$';
  if (/\b(moderate|moderately\s+priced|reasonably\s+priced)\b/i.test(t)) return '$$';
  if (/\b(expensive|upscale|fancy|splurge)\b/i.test(t)) return '$$$';
  return null;
}
export function budgetMaxFromText(text) {
  const m = String(text ?? '').match(/\b(under|less\s+than|below|max(imum)?|up\s+to|no\s+more\s+than)\s+\$\s?(\d{1,6})\b|\$\s?(\d{1,6})\s+(or\s+less|max)\b/i);
  const n = m ? Number(m[3] ?? m[4]) : null;
  return n && n > 0 ? n : null;
}

// ---- support checks for AI-returned facts ----
const NUMBER_WORDS = /\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|couple\s+of|pair)\b/i;

// Words that must appear for an AI occasion to be kept (mirrors the classifier prompt's own mapping). 'other' and any
// occasion without an entry are dropped: missing stays missing.
const OCCASION_SUPPORT = {
  birthday: /\bbirthday|\bturning\s+\d/i,
  anniversary: /\banniversary/i,
  date_night: /\bdate\b/i,
  first_date: /\bfirst\s+(date|time|meet)/i,
  celebration: /\bcelebrat/i,
  graduation: /\bgraduat|\bgrad\s+party/i,
  baby_shower: /\bbaby\s+shower/i,
  engagement: /\bengage/i,
  housewarming: /\bhousewarming|\bnew\s+place|\bmoved\s+into/i,
  promotion: /\bpromot|\bnew\s+job|\bfirst\s+day\s+at\s+work/i,
  new_job: /\bnew\s+job/i,
  achievement: /\bachiev/i,
  farewell: /\bfarewell|\bgoing\s+away|\blast\s+day|\bmoving\s+away/i,
  milestone: /\bmilestone|\bretire/i,
  bachelor_bachelorette: /\bbachelor|\bhen\s+party/i,
  fundraiser: /\bfundrais|\bcharity|\bbenefit\s+dinner/i,
  self_care: /\bself[- ]care|\bspa\b|\btreat\s+myself|\bpamper/i,
  networking: /\bnetwork|\bprofessionals\b/i,
  vacation: /\bvacation|\bholiday\s+trip|\bgetaway|\btrip\s+to\b/i,
  casual_hangout: /\bhang(ing)?\s*out|\bnothing\s+special/i,
  business_meal: /\bwork\s+(dinner|lunch)|\bclient|\bteam\s+lunch|\bbusiness\s+(dinner|lunch|meal)/i,
  family_gathering: /\bfamily\s+reunion|\bvisiting\s+family|\breunion/i,
};
const OCCASION_KEYS = new Set(OCCASION_OPTIONS.map((o) => o.key));

export function aiOccasionSupported(occasion, text) {
  if (!occasion || !OCCASION_KEYS.has(occasion)) return false;
  const re = OCCASION_SUPPORT[occasion];
  return !!re && re.test(String(text ?? ''));
}

function realTag(tag) {
  return typeof tag === 'string' && canonicalGroupForTag(tag) ? tag : null;
}

// The structured result. `ai` is the classifier's raw reply, or null when it did not run / failed.
export function resolveAsk(text, ai = null) {
  const t = String(text ?? '').trim();
  const a = ai && typeof ai === 'object' ? ai : {};
  const sources = {};
  const set = (field, value, source) => { if (value != null && !(Array.isArray(value) && value.length === 0)) sources[field] = source; return value; };

  const plan = planAsk(t);

  // WHAT: the AI classifies when it gives a real consumer tag; else the synonym table. A multi-part plan has no single category.
  const aiTag = realTag(a.category);
  const wordTag = tagsForPhrase(t).find((x) => realTag(x)) ?? null;
  const subcategory = plan ? null : set('subcategory', aiTag ?? wordTag, aiTag ? 'ai' : 'words');
  const categoryKey = subcategory ? canonicalGroupForTag(subcategory) : null;
  if (categoryKey) sources.category = sources.subcategory;

  // WHO: the words decide (the AI's party type is a fact, and the rules cover its whole mapping).
  const partyType = set('partyType', groupFromText(t), 'words');
  const wordSize = partySizeFromText(t);
  const aiSize = Number.isInteger(a.partySize) && a.partySize > 0 && (NUMBER_WORDS.test(t) || (a.partySize === 2 && partyType === 'date')) ? a.partySize : null;
  const partySize = wordSize != null ? set('partySize', wordSize, 'words') : set('partySize', aiSize, 'ai');

  // WHEN: explicit words only. The AI's dateWindow is never used on its own.
  const dateWindow = set('dateWindow', dateWindowFromText(t), 'words');
  const whenPreset = whenPresetFromText(t);

  // WHY: explicit words / the couple-evening rule first; an AI occasion only when the words support it.
  const wordOccasion = occasionFromAsk(t, { partyType, dateWindow });
  const occasion = wordOccasion
    ? set('occasion', wordOccasion, 'words')
    : set('occasion', aiOccasionSupported(a.occasion, t) ? a.occasion : null, 'ai');

  // HOW MUCH: words first; an AI value only when the words carry a figure / a price word.
  const priceLevel = priceLevelFromText(t) != null
    ? set('priceLevel', priceLevelFromText(t), 'words')
    : null;
  const wordBudget = budgetMaxFromText(t);
  const aiBudget = Number.isInteger(a.budgetMax) && a.budgetMax > 0 && /\$|\d/.test(t) ? a.budgetMax : null;
  const budgetMax = wordBudget != null ? set('budgetMax', wordBudget, 'words') : set('budgetMax', aiBudget, 'ai');

  // CHARACTERISTICS: the AI's closed-vocabulary attributes plus the words' own.
  const attributes = [...new Set([...(Array.isArray(a.attributes) ? a.attributes : []), ...attributesFromAsk(t, { partyType })])];
  set('attributes', attributes, Array.isArray(a.attributes) && a.attributes.length ? 'ai' : 'words');

  const activities = set('activities', activitiesFromText(t), 'words');
  const intent = typeof a.intent === 'string' ? a.intent : (subcategory || plan ? 'gathering' : 'unclear');

  return {
    text: t,
    intent,
    title: (typeof a.title === 'string' && a.title.trim()) || (subcategory ? titleFromText(t) : null),
    businessName: a.businessName ?? null,
    category: categoryKey ? { key: categoryKey, label: CATEGORY_GROUPS.find((g) => g.key === categoryKey)?.label ?? null } : null,
    subcategory,
    activities,
    attributes,
    // Item 76: the AI's cuisine, else the one the words name ("italian dinner", "sushi"); a cuisine is classification.
    cuisine: a.cuisine ? set('cuisine', a.cuisine, 'ai') : set('cuisine', cuisineFromText(t), 'words'),
    occasion,
    group: { partyType, partySize },
    time: { dateWindow, whenPreset },
    budget: { priceLevel, budgetMax },
    plan,
    // Item 64: the named multi-part combination this ask is (Date Night, Night Out, Beach Day...), or null.
    combination: recognizeCombination({ text: t, occasion, partyType, dateWindow, attributes })?.key ?? null,
    facets: parseAskFacets(t),
    energies: energiesFromText(t),
    // Item 66: HOW it runs (tournament, open play, class...), separate from the category; words only.
    formats: formatsFromText(t),
    // Item 67: skill level the person named (beginner, casual game, competitive...); words only.
    skillLevels: skillLevelsFromText(t),
    // Declared-genre words the person typed (rock, jazz, techno -> electronic...); ranking only against a host-declared genre.
    genres: genresFromText(t),
    // Intensity / effort, only when an activity word sits next to the qualifier ('easy hike', 'high intensity workout').
    intensity: intensityFromText(t),
    effort: effortFromText(t),
    // Social scale + meet-new-people, words only; a temporary contract compared against existing gathering fields, never stored.
    social: socialSignalsFromText(t),
    // Item 69: how far the person said they will go (very_nearby / nearby / anywhere_in_area / willing_to_travel), or null.
    distanceWillingness: distanceWillingnessFromText(t),
    // How the person said they are getting there (walking / bike / driving / rideshare / transit), or null; words only.
    transportMode: transportModeFromText(t),
    // Item 68: minutes the person said they have ("I only have an hour" = 60), or null. Never a start time.
    timeBudgetMinutes: timeBudgetFromText(t),
    // A clock boundary/range from the words, and the calendar date(s) the words anchor it to (null = none said; nothing chosen).
    clockWindow: clockWindowFromText(t),
    dateAnchor: dateAnchorFromText(t),
    commitment: commitmentAsk(t),
    spontaneity: spontaneityOf({ dateWindow, rawText: t }),
    sources,
    usedAi: !!ai,
  };
}

// The classifier-compatible shape every existing consumer already reads, carrying the structured result along.
export function toClassification(r) {
  return {
    intent: r.intent,
    title: r.title,
    category: r.subcategory,
    businessName: r.businessName,
    partySize: r.group.partySize,
    partyType: r.group.partyType,
    dateWindow: r.time.dateWindow,
    budgetMax: r.budget.budgetMax,
    priceLevel: r.budget.priceLevel,
    attributes: r.attributes,
    cuisine: r.cuisine,
    occasion: r.occasion,
    structured: r,
    ...(r.usedAi ? {} : { deterministic: true }),
  };
}

// Create Gathering prefill from the structured result (all entry points). Title + real category = start after What.
export function createParamsFromAsk(r, typedText) {
  const inf = {
    tag: r.subcategory,
    categoryLabel: r.category?.label ?? null,
    partyType: r.group.partyType,
    partySize: r.group.partySize,
    whenPreset: r.time.whenPreset,
    activities: r.activities,
  };
  const title = r.title || typedText || null;
  return {
    quickStartTitle: title,
    quickStartCategory: r.subcategory,
    quickStartPartySize: r.group.partySize,
    quickStartPartyType: r.group.partyType,
    ...(r.time.whenPreset ? { quickStartWhenPreset: r.time.whenPreset } : {}),
    inferredSummary: inferredSummary(inf),
    inferredFromText: !!(r.title && r.subcategory),
  };
}
