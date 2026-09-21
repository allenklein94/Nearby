// Combinations and negative intent (owner items 47/48, 2026-09-21). "Something fun outside tonight under $30 with my girlfriend" already
// yields time, budget, party type and an open-ended "fun"; this adds what it did not: the ENVIRONMENT (outside) and a couple word
// ("girlfriend" = a date party), and EXCLUSIONS from the person's own words -- "no alcohol", "nothing outdoors", "nothing crowded",
// "not too expensive". Deterministic, never AI. An exclusion drops a result ONLY when that result's own KNOWN property conflicts
// (its category tag, or a gathering's real capacity/attendance); a result with nothing known is kept, so a gap in our data never
// hides something the person might want. Budget stays the locked rule: over-budget is ordered, never hidden, so "not too expensive"
// only sinks a known $$$ result. The caption always says what was left out, so nothing disappears silently.
import { CATEGORY_GROUPS, groupForTag } from './gatheringCategories';
import { CATEGORY_INDOOR_OUTDOOR } from './gatheringIndoorOutdoor';

export const ALCOHOL_TAGS = ['Bars & Lounges', 'Breweries', 'Wine', 'Wineries', 'Happy Hour', 'Nightclubs'];
export const CROWDED_TAGS = ['Festivals', 'Nightclubs', 'Concerts', 'Nightlife', 'Street Events', 'Special Events'];
export const CROWDED_CAPACITY_MIN = 20; // my default: a gathering with room for 20+ (or 20+ going) is a crowd

const NEG_OUTDOOR = /\b(?:no|nothing|not|without|avoid|skip)\s+(?:anything\s+|too\s+|be\s+)?(?:outdoors?|outside)\b|\b(?:don'?t|do not)\s+want\s+(?:to\s+be\s+|anything\s+)?(?:outdoors?|outside)\b|\bindoors?\s+only\b/gi;
const NEG_INDOOR = /\b(?:no|nothing|not|without|avoid)\s+(?:anything\s+|too\s+)?indoors?\b/gi;
const NEG_ALCOHOL = /\b(?:no|without|avoid|skip)\s+(?:any\s+)?(?:alcohol|booze|drinking)\b|\bnothing\s+(?:with|involving)\s+(?:alcohol|booze)\b|\bnon[- ]?alcoholic\b|\balcohol[- ]free\b|\bsober\b/gi;
const NEG_CROWD = /\b(?:no|nothing|not|avoid|without)\s+(?:anything\s+|too\s+|be\s+|a\s+)?(?:crowded|packed|busy)\b|\bno\s+crowds?\b|\b(?:don'?t|do not)\s+want\s+(?:anything\s+|to\s+be\s+)?(?:crowded|packed|busy)\b/gi;
const NEG_PRICEY = /\bnot\s+too\s+(?:expensive|pricey)\b|\b(?:no|nothing)\s+(?:too\s+)?(?:expensive|pricey)\b/gi;
const POS_OUTDOOR = /\b(?:outside|outdoors?|open[- ]air)\b/i;
const POS_INDOOR = /\bindoors?\b/i;
const PARTNER = /\b(girlfriend|boyfriend|wife|husband|fianc[ée]e?|partner|spouse|my\s+date|date\s+night)\b/i;

export const EXCLUSION_LABELS = { alcohol: 'alcohol', outdoor: 'outdoor options', indoor: 'indoor options', crowded: 'crowded places' };

// { environment: 'outdoor'|'indoor'|null, exclude: string[], pricey: boolean } -- empty/false when the ask says none of it.
export function parseAskFacets(text) {
  const out = { environment: null, exclude: [], pricey: false };
  if (typeof text !== 'string' || !text) return out;
  let rest = text;
  const take = (re, on) => { if (re.test(rest)) { on(); } rest = rest.replace(re, ' '); };
  take(NEG_OUTDOOR, () => out.exclude.push('outdoor'));
  take(NEG_INDOOR, () => out.exclude.push('indoor'));
  take(NEG_ALCOHOL, () => out.exclude.push('alcohol'));
  take(NEG_CROWD, () => out.exclude.push('crowded'));
  take(NEG_PRICEY, () => { out.pricey = true; });
  // Positive environment only from what is left after the negations were removed ("nothing outdoors" must not read as outdoors).
  if (POS_OUTDOOR.test(rest) && !out.exclude.includes('outdoor')) out.environment = 'outdoor';
  else if (POS_INDOOR.test(rest) && !out.exclude.includes('indoor')) out.environment = 'indoor';
  return out;
}

// "my girlfriend" / "my wife" -> a date party. Only used when the extractor gave no party type.
export function partnerPartyType(text) {
  return typeof text === 'string' && PARTNER.test(text) ? 'date' : null;
}

export function environmentOf(tag) {
  if (!tag) return null;
  if (CATEGORY_INDOOR_OUTDOOR[tag]) return CATEGORY_INDOOR_OUTDOOR[tag];
  const g = groupForTag(tag);
  return g?.key === 'outdoors_nature' ? 'outdoor' : null;
}

function conflicts(c, key) {
  const tag = c?.category;
  if (key === 'alcohol') return ALCOHOL_TAGS.includes(tag);
  if (key === 'outdoor') return environmentOf(tag) === 'outdoor';
  if (key === 'indoor') return environmentOf(tag) === 'indoor';
  if (key === 'crowded') {
    if (CROWDED_TAGS.includes(tag)) return true;
    return Math.max(c?.capacity ?? 0, c?.attendeeCount ?? 0) >= CROWDED_CAPACITY_MIN;
  }
  return false;
}

export const ENVIRONMENT_POINTS = 2;
export const PRICEY_POINTS = -2;

// Applies the parsed facets to scored candidates: exclusions drop known conflicts, an environment lifts its match, "not too expensive"
// sinks a known $$$. Returns { items, caption } (caption null when the ask stated none of these).
export function applyAskFacets(candidates, facets) {
  if (!facets || (!facets.environment && !facets.exclude.length && !facets.pricey)) return { items: candidates, caption: null };
  const items = candidates
    .filter((c) => !facets.exclude.some((k) => conflicts(c, k)))
    .map((c) => {
      let delta = 0;
      const env = environmentOf(c?.category);
      if (facets.environment && env) delta += env === facets.environment ? ENVIRONMENT_POINTS : -1;
      if (facets.pricey && c?.priceLevel === '$$$') delta += PRICEY_POINTS;
      return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
    });
  const parts = [...facets.exclude.map((k) => EXCLUSION_LABELS[k]), ...(facets.pricey ? ['pricier options'] : [])];
  const list = parts.length <= 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return { items, caption: parts.length ? `Leaving out ${list}` : null };
}

// Attributes the person's own words name (owner items 51/52). A coffee shop stays Food & Drink -> Coffee and CARRIES dog_friendly /
// date_friendly / quiet / outdoor_seating as attributes; the ask names them the same way, so "coffee with my dog" and "somewhere
// romantic and quiet" reach those businesses through the existing attribute overlap (ranking only). Deterministic, a fallback beside
// the AI extractor (which only knew "can bring my dog"); the result is unioned with whatever it returned. Closed keys only.
const ATTRIBUTE_ASKS = [
  ['dog_friendly', /\b(?:with|bring(?:ing)?|take|taking)\s+(?:my|our|the)\s+(?:dog|dogs|puppy|pup)\b|\b(?:dog|pet)[- ]friendly\b|\bpets?\s+(?:allowed|welcome)\b|\bpet[- ]friendly\b/i],
  ['date_friendly', /\b(?:date\s+night|first\s+date|on\s+a\s+date|for\s+a\s+date|date\s+spot|romantic|date[- ]friendly)\b/i],
  ['quiet', /(?<!\b(?:not|no|nothing|too|not too|nothing too)\s)\b(?:quiet|peaceful)\b/i],
  ['outdoor_seating', /\b(?:patio|outdoor\s+seating|al\s+fresco|terrace)\b/i],
];
export function attributesFromAsk(text, { partyType = null } = {}) {
  if (typeof text !== 'string') return partyType === 'date' ? ['date_friendly'] : [];
  const out = ATTRIBUTE_ASKS.filter(([, re]) => re.test(text)).map(([k]) => k);
  // A date-shaped party (a couple word, or the extractor's own `date`) is the date-friendly quality by definition.
  if ((partyType === 'date' || partnerPartyType(text)) && !out.includes('date_friendly')) out.push('date_friendly');
  return out;
}

export const FACET_GROUP_KEYS = CATEGORY_GROUPS.map((g) => g.key); // (kept so a test can tie outdoors_nature to a real group)
