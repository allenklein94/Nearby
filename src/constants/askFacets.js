// Combinations and negative intent (owner items 47/48, 2026-09-21). "Something fun outside tonight under $30 with my girlfriend" already
// yields time, budget, party type and an open-ended "fun"; this adds what it did not: the ENVIRONMENT (outside) and a couple word
// ("girlfriend" = a date party), and EXCLUSIONS from the person's own words -- "no alcohol", "nothing outdoors", "nothing crowded",
// "not too expensive". Deterministic, never AI. An exclusion drops a result ONLY when that result's own KNOWN property conflicts
// (its category tag, or a gathering's real capacity/attendance); a result with nothing known is kept, so a gap in our data never
// hides something the person might want. Budget stays the locked rule: over-budget is ordered, never hidden, so "not too expensive"
// only sinks a known $$$ result. The caption always says what was left out, so nothing disappears silently.
import { splitHedge } from '../utils/askPreferences';
import { vibesFromAsk } from './businessVibes';
import { appendReason, askedForEnvironmentReason } from './recommendationReasonVocabulary';
import { CATEGORY_GROUPS, groupForTag } from './gatheringCategories';
import { categoryEnvironment } from './gatheringIndoorOutdoor';

export const ALCOHOL_TAGS = ['Bars & Lounges', 'Breweries', 'Wine', 'Wineries', 'Happy Hour', 'Nightclubs'];
export const CROWDED_TAGS = ['Festivals', 'Nightclubs', 'Concerts', 'Nightlife', 'Street Events', 'Special Events'];
export const CROWDED_CAPACITY_MIN = 20; // my default: a gathering with room for 20+ (or 20+ going) is a crowd

const NEG_OUTDOOR = /\b(?:no|nothing|not|without|avoid|skip)\s+(?:anything\s+|too\s+|be\s+)?(?:outdoors?|outside)\b|\b(?:don'?t|do not)\s+want\s+(?:to\s+be\s+|anything\s+)?(?:outdoors?|outside)\b|\bindoors?\s+only\b/gi;
const NEG_INDOOR = /\b(?:no|nothing|not|without|avoid)\s+(?:anything\s+|too\s+)?indoors?\b/gi;
const NEG_ALCOHOL = /\b(?:no|without|avoid|skip)\s+(?:any\s+)?(?:alcohol|booze|drinking)\b|\bnothing\s+(?:with|involving)\s+(?:alcohol|booze)\b|\bnon[- ]?alcoholic\b|\balcohol[- ]free\b|\bsober\b/gi;
const NEG_CROWD = /\b(?:no|nothing|not|avoid|without)\s+(?:anything\s+|too\s+|be\s+|a\s+)?(?:crowded|packed|busy)\b|\bno\s+crowds?\b|\b(?:don'?t|do not)\s+want\s+(?:anything\s+|to\s+be\s+)?(?:crowded|packed|busy)\b/gi;
const NEG_PRICEY = /\bnot\s+too\s+(?:expensive|pricey)\b|\b(?:no|nothing)\s+(?:too\s+)?(?:expensive|pricey)\b/gi;
const POS_OUTDOOR = /\b(?:outside|outdoors?|open[- ]air)\b/i;
// Sitting outside AT a place ("coffee where we can sit outside") is the outdoor_seating attribute, not an outdoor activity: it must
// not sink an indoor-category place (a café with a patio is exactly the answer). Read as the attribute, removed before the environment test.
const OUTSIDE_SEATING = /\b(?:sit(?:ting)?|eat(?:ing)?|dine|dining|drink(?:ing)?)\s+(?:outside|outdoors)\b|\b(?:outside|outdoor)\s+(?:seating|tables?)\b/gi;
const POS_INDOOR = /\bindoors?\b/i;
// Item 105: how sure the person sounds about an environment. Tentative = a preference, firm (or plain) = a must.
const TENTATIVE = /\b(?:maybe|perhaps|possibly|probably|might|could\s+be|or\s+something|not\s+sure|i\s+guess|kind\s+of|sort\s+of|open\s+to)\b/i;
const FIRM = /\b(?:definitely|absolutely|must|has\s+to|have\s+to|needs?\s+to|only|really\s+want|for\s+sure)\b/i;
const PARTNER = /\b(girlfriend|boyfriend|wife|husband|fianc[ée]e?|partner|spouse|my\s+date|date\s+night)\b/i;

export const UNKNOWN_SIDE_LABEL = "places that haven't said";
export const EXCLUSION_LABELS = { alcohol: 'alcohol', outdoor: 'outdoor options', indoor: 'indoor options', crowded: 'crowded places' };

// { environment: 'outdoor'|'indoor'|null, exclude: string[], pricey: boolean } -- empty/false when the ask says none of it.
export function parseAskFacets(text) {
  const out = { environment: null, environmentRequired: false, exclude: [], pricey: false };
  if (typeof text !== 'string' || !text) return out;
  let rest = text;
  const take = (re, on) => { if (re.test(rest)) { on(); } rest = rest.replace(re, ' '); };
  take(NEG_OUTDOOR, () => out.exclude.push('outdoor'));
  take(NEG_INDOOR, () => out.exclude.push('indoor'));
  take(NEG_ALCOHOL, () => out.exclude.push('alcohol'));
  take(NEG_CROWD, () => out.exclude.push('crowded'));
  take(NEG_PRICEY, () => { out.pricey = true; });
  rest = rest.replace(OUTSIDE_SEATING, ' ');
  // Positive environment only from what is left after the negations were removed ("nothing outdoors" must not read as outdoors).
  if (POS_OUTDOOR.test(rest) && !out.exclude.includes('outdoor')) out.environment = 'outdoor';
  else if (POS_INDOOR.test(rest) && !out.exclude.includes('indoor')) out.environment = 'indoor';
  // Item 103: a plainly stated environment is a MUST ("somewhere outside tonight": only known-outdoor results stay, 2026-10-02);
  // one said only after a hedge ("preferably outside") stays a preference (the lift below, nothing removed).
  // Item 105 (2026-09-27): tentative wording in the SAME sentence ("maybe something outdoors?", "perhaps outside") is also only a
  // preference; firm wording ("definitely outside", "has to be outdoors") keeps it a must even beside a "maybe".
  if (out.environment) {
    const h = splitHedge(text);
    const plainRe = out.environment === 'outdoor' ? POS_OUTDOOR : POS_INDOOR;
    const plain = (h ? `${h.before}. ${h.rest}` : text).replace(OUTSIDE_SEATING, ' ');
    out.environmentRequired = plain.split(/[.;!?\n]+/).some((sentence) => plainRe.test(sentence) && (FIRM.test(sentence) || !TENTATIVE.test(sentence)));
  }
  return out;
}

// "my girlfriend" / "my wife" -> a date party. Only used when the extractor gave no party type.
export function partnerPartyType(text) {
  return typeof text === 'string' && PARTNER.test(text) ? 'date' : null;
}

// A category's side: the one shared rule (gatheringIndoorOutdoor.categoryEnvironment).
export function environmentOf(tag) {
  return categoryEnvironment(tag);
}

// A typed-ask candidate's side when no resolver-built envOf is given (older callers and tests): its category.
const categoryEnvOf = (c) => environmentOf(c?.category);

function conflicts(c, key, envOf = categoryEnvOf) {
  const tag = c?.category;
  if (key === 'alcohol') return ALCOHOL_TAGS.includes(tag);
  if (key === 'outdoor') return envOf(c) === 'outdoor';
  if (key === 'indoor') return envOf(c) === 'indoor';
  if (key === 'crowded') {
    if (CROWDED_TAGS.includes(tag)) return true;
    // capacity counts everyone including the host; attendeeCount is guests only, so the host is added once here.
    return Math.max(c?.capacity ?? 0, typeof c?.attendeeCount === 'number' ? c.attendeeCount + 1 : 0) >= CROWDED_CAPACITY_MIN;
  }
  return false;
}

export const ENVIRONMENT_POINTS = 2;
export const PRICEY_POINTS = -2;

// Applies the parsed facets to scored candidates: exclusions drop known conflicts, an environment lifts its match, "not too expensive"
// sinks a known $$$. Returns { items, caption } (caption null when the ask stated none of these).
// Item 118: the eligibility half (typed-ask Stage 1, utils/askEligibility.js). A firm environment removes KNOWN opposites; an
// exclusion removes a result only when its own known property conflicts. Unknown is kept.
// envOf(c): the candidate's side (the resolver passes constants/environmentMatch.js's declared-data rule; default = category).
// Owner, 2026-10-02 (supersedes item 103's "unknown kept"): a FIRM indoor/outdoor ask keeps only results whose side is KNOWN to
// be the asked one (constants/environmentMatch.js: declared data, a gathering's category); the opposite AND unknown are removed,
// the same strictness as Discover's Outdoor/Indoor narrowing. A tentative/hedged ask (item 105) removes nothing.
export function askFacetsEligible(candidates, facets, envOf = categoryEnvOf) {
  if (!facets || (!facets.environment && !facets.exclude.length && !facets.pricey)) return { items: candidates, removedOpposite: false, removedUnknown: false };
  const strict = facets.environmentRequired && !!facets.environment;
  const opposite = facets.environment === 'outdoor' ? 'indoor' : 'outdoor';
  let removedOpposite = false;
  let removedUnknown = false;
  const kept = !strict ? candidates : candidates.filter((c) => {
    const env = envOf(c);
    if (env === facets.environment) return true;
    if (env === opposite) removedOpposite = true; else removedUnknown = true;
    return false;
  });
  return { items: kept.filter((c) => !facets.exclude.some((k) => conflicts(c, k, envOf))), removedOpposite, removedUnknown };
}

// The ranking half (Stage 2): a stated environment lifts its match and nudges a known opposite; "not too expensive" sinks $$$.
// A result whose side matches the asked one also carries the real reason (askedForEnvironmentReason).
export function askFacetsLift(candidates, facets, envOf = categoryEnvOf) {
  if (!facets || (!facets.environment && !facets.pricey)) return candidates;
  return candidates.map((c) => {
    let delta = 0;
    const env = envOf(c);
    const matched = !!(facets.environment && env && env === facets.environment);
    if (facets.environment && env) delta += matched ? ENVIRONMENT_POINTS : -1;
    if (facets.pricey && c?.priceLevel === '$$$') delta += PRICEY_POINTS;
    if (!delta && !matched) return c;
    const next = { ...c, score: (c.score ?? 0) + delta };
    if (matched) next.reasons = appendReason(c.reasons, askedForEnvironmentReason(facets.environment));
    return next;
  });
}

// What was left out, in one line (the exclusions the words named, the opposite environment only when one was really removed).
export function askFacetsCaption(facets, removedOpposite = false, removedUnknown = false) {
  if (!facets || (!facets.environment && !facets.exclude.length && !facets.pricey)) return null;
  const opposite = facets.environment === 'outdoor' ? 'indoor' : 'outdoor';
  const parts = [...facets.exclude.map((k) => EXCLUSION_LABELS[k]), ...(removedOpposite ? [EXCLUSION_LABELS[opposite]] : []),
    ...(removedUnknown ? [UNKNOWN_SIDE_LABEL] : []), ...(facets.pricey ? ['pricier options'] : [])];
  const list = parts.length <= 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return parts.length ? `Leaving out ${list}` : null;
}

// All three in one call (older callers and tests).
export function applyAskFacets(candidates, facets) {
  if (!facets || (!facets.environment && !facets.exclude.length && !facets.pricey)) return { items: candidates, caption: null };
  const { items, removedOpposite, removedUnknown } = askFacetsEligible(candidates, facets);
  return { items: askFacetsLift(items, facets), caption: askFacetsCaption(facets, removedOpposite, removedUnknown) };
}

// Attributes the person's own words name (owner items 51/52). A coffee shop stays Food & Drink -> Coffee and CARRIES dog_friendly /
// date_friendly / quiet / outdoor_seating as attributes; the ask names them the same way, so "coffee with my dog" and "somewhere
// romantic and quiet" reach those businesses through the existing attribute overlap (ranking only). Deterministic, a fallback beside
// the AI extractor (which only knew "can bring my dog"); the result is unioned with whatever it returned. Closed keys only.
// Item 88: an access need is stated per ask, in the person's own words, maps ONLY to the existing accessibility attributes, and is
// never stored (utils/sensitiveNeeds.js strips these phrases before any search log).
export const ACCESSIBILITY_ASKS = [
  ['wheelchair_accessible', /\bwheelchair[- ]accessible\b|\bwheelchairs?\b|\bstep[- ]free\b|\bno\s+stairs\b/i],
  ['accessible_parking', /\b(?:accessible|handicap(?:ped)?|disabled|disability|ada)\s+parking\b/i],
  ['accessible_restroom', /\b(?:accessible|handicap(?:ped)?|disabled|ada)\s+(?:restrooms?|bathrooms?|toilets?)\b/i],
];
const ATTRIBUTE_ASKS = [
  ['pet_friendly', /\b(?:with|bring(?:ing)?|take|taking)\s+(?:my|our|the)\s+(?:dog|dogs|puppy|pup|cat|cats|pet|pets)\b|\bpets?[- ]friendly\b|\bdog[- ]friendly\b|\bpets?\s+(?:allowed|welcome)\b/i],
  ['dog_friendly', /\b(?:with|bring(?:ing)?|take|taking)\s+(?:my|our|the)\s+(?:dog|dogs|puppy|pup)\b|\b(?:dog|pet)[- ]friendly\b|\bpets?\s+(?:allowed|welcome)\b|\bpet[- ]friendly\b/i],
  ['date_friendly', /\b(?:date\s+night|first\s+date|on\s+a\s+date|for\s+a\s+date|date\s+spot|romantic|date[- ]friendly)\b/i],
  ['outdoor_seating', /\b(?:patio|outdoor\s+seating|al\s+fresco|terrace)\b|\b(?:sit(?:ting)?|eat(?:ing)?|dine|dining|drink(?:ing)?)\s+(?:outside|outdoors)\b|\boutside\s+(?:seating|tables?)\b/i],
  ...ACCESSIBILITY_ASKS,
];
export function attributesFromAsk(text, { partyType = null } = {}) {
  if (typeof text !== 'string') return partyType === 'date' ? ['date_friendly'] : [];
  const out = ATTRIBUTE_ASKS.filter(([, re]) => re.test(text)).map(([k]) => k);
  // "nothing outside" / "don't want to sit outside" is never an ask for outdoor seating.
  const negSeating = /\b(?:don'?t|do\s+not|can'?t|cannot|won'?t|not|never|no)\s+(?:want\s+to\s+|wanna\s+|like\s+to\s+)?(?:sit|eat|dine|drink)\w*\s+(?:outside|outdoors)\b/i;
  if ((negSeating.test(text) || parseAskFacets(text).exclude.includes('outdoor')) && out.includes('outdoor_seating')) out.splice(out.indexOf('outdoor_seating'), 1);
  // Items 83/84: the vibes the person asked for (quiet and romantic included), from the ONE synonym table in businessVibes.js ("relaxed and quiet"); a negated vibe is never an ask.
  const vibes = vibesFromAsk(text);
  for (const k of vibes.want) if (!out.includes(k)) out.push(k);
  for (const k of vibes.avoid) if (out.includes(k)) out.splice(out.indexOf(k), 1);
  // A date-shaped party (a couple word, or the extractor's own `date`) is the date-friendly quality by definition.
  if ((partyType === 'date' || partnerPartyType(text)) && !out.includes('date_friendly')) out.push('date_friendly');
  return out;
}

export const FACET_GROUP_KEYS = CATEGORY_GROUPS.map((g) => g.key); // (kept so a test can tie outdoors_nature to a real group)
