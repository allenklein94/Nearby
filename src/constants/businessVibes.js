// Item 83: VIBE, the feel of a place. A named view over the ONE shared attribute vocabulary (businessAttributes.js), never a
// second store: a business declares a vibe by ticking the attribute; nothing is inferred. Twelve words the owner listed, eleven
// keys: Energetic is the same key as Lively (two chips for one meaning would make owners pick both), Family-friendly is the
// existing kid_friendly.
//
// Asks: "somewhere relaxed and quiet" -> want [relaxed, quiet]; "nothing too lively" / "not too fancy" -> avoid [lively] /
// [upscale]. Deterministic phrase rules on the person's own words, never AI. Ranking only: a wanted vibe lifts through the
// existing attribute overlap (attributeAndCuisineBonus + applyDeclaredFeatures); a DECLARED avoided vibe, or the declared
// opposite of a wanted one (quiet vs lively, relaxed vs lively, casual vs upscale), sinks a little. Undeclared = neutral,
// nothing is removed.
export const VIBES = [
  { key: 'casual', label: 'Casual' },
  { key: 'upscale', label: 'Upscale' },
  { key: 'romantic', label: 'Romantic' },
  { key: 'lively', label: 'Lively', alsoCalled: ['Energetic'] },
  { key: 'quiet', label: 'Quiet' },
  { key: 'trendy', label: 'Trendy' },
  { key: 'kid_friendly', label: 'Family-friendly' },
  { key: 'relaxed', label: 'Relaxed' },
  { key: 'social', label: 'Social' },
  { key: 'cozy', label: 'Cozy' },
  { key: 'professional', label: 'Professional' },
];
export const VIBE_KEYS = VIBES.map((v) => v.key);

// Item 85: the vibes that describe a DATE, offered as "What kind of date?" on a matched pair's request. Family-friendly,
// Professional and Social describe other plans, so they are left out of this row (never hidden elsewhere).
export const DATE_VIBES = VIBES.filter((v) => !['kid_friendly', 'professional', 'social'].includes(v.key));
// A place fits a date by what its owner DECLARED: date-friendly or romantic. Nothing else (never its category) makes the claim.
export const DATE_PLACE_KEYS = ['date_friendly', 'romantic'];

// Item 84: ONE synonym table per vibe. Every word a person or an owner might use lands on exactly one canonical key; nobody can
// add a vibe (the attribute CHECKs refuse anything else) and no second word list exists: the ask parser (vibesFromAsk) and
// "Teach Nearby" (businessAttributeExtraction) both read this table. A phrase belongs to one vibe only (tested).
// `not` = what may not follow the phrase (look-alikes: "casual game", "professional development", "chilled wine").
export const VIBE_SYNONYMS = {
  casual: { phrases: ['casual', 'no dress code', 'come as you are', 'dress down'], not: ['game', 'games', 'date', 'dates', 'dating', 'hookup', 'hook up', 'sex', 'encounter', 'friend', 'friends', 'player', 'players', 'level'] },
  upscale: { phrases: ['upscale', 'fancy', 'high-end', 'high end', 'classy', 'elegant', 'swanky', 'posh', 'fine dining', 'dress up', 'dressed up', 'luxurious', 'luxury'] },
  romantic: { phrases: ['romantic', 'candlelit', 'candle-lit', 'candle lit', 'candlelight', 'intimate setting'] },
  lively: { phrases: ['lively', 'energetic', 'buzzing', 'buzzy', 'vibrant', 'high-energy', 'high energy', 'upbeat', 'bustling'] },
  quiet: { phrases: ['quiet', 'peaceful', 'hushed', 'tranquil', 'serene'] },
  trendy: { phrases: ['trendy', 'stylish', 'instagrammable', 'hot spot', 'fashionable'] },
  kid_friendly: { phrases: ['family-friendly', 'family friendly', 'kid-friendly', 'kid friendly', 'kids-friendly', 'child-friendly', 'child friendly', 'kids welcome', 'families welcome', 'great for families', 'great for kids', 'whole family', 'family restaurant', 'with my kids', 'with our kids', 'with the kids', 'with my children', 'with our children', 'with the little ones'] },
  relaxed: { phrases: ['relaxed', 'chill', 'chilled', 'chilled out', 'chill out', 'laid back', 'laid-back', 'low-key', 'low key', 'lowkey', 'calm', 'mellow', 'easygoing', 'easy-going', 'easy going', 'unhurried'], not: ['wine', 'wines', 'beer', 'beers', 'drink', 'drinks', 'glass', 'glasses', 'soup', 'dessert', 'desserts', 'water', 'bottle', 'bottles'] },
  social: { phrases: ['social spot', 'social place', 'social vibe', 'social atmosphere', 'social scene', 'social bar', 'social crowd', 'somewhere social', 'communal table', 'communal tables', 'mingle', 'mingling'] },
  cozy: { phrases: ['cozy', 'cosy', 'snug', 'warm and inviting'] },
  professional: { phrases: ['professional', 'business meeting', 'business meetings', 'business lunch', 'business dinner', 'business coffee', 'client meeting', 'client meetings', 'client lunch', 'client dinner', 'client coffee', 'work meeting', 'work lunch', 'meeting space', 'meet a client', 'meeting a client', 'meet with a client'], not: ['development', 'photographer', 'photography', 'headshot', 'headshots', 'cleaning', 'service', 'services', 'help', 'advice', 'athlete', 'athletes', 'league'] },
};

const esc = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]?');
const VIBE_ASKS = Object.fromEntries(Object.entries(VIBE_SYNONYMS).map(([key, { phrases, not = [] }]) => {
  const alts = [...phrases].sort((a, b) => b.length - a.length).map(esc).join('|');
  const tail = not.length ? `(?!\\s+(?:${not.map(esc).join('|')})\\b)` : '';
  return [key, new RegExp(`\\b(?:${alts})\\b${tail}`, 'gi')];
}));

const NEGATION_BEFORE = /\b(?:not|no|nothing|never|isn't|without|avoid|too)\s+(?:too\s+|very\s+|overly\s+|that\s+|super\s+|so\s+)?$/i;
// "nothing fancy" also says what the person DOES want: casual.
const NOTHING_FANCY = /\b(?:nothing|not)\s+(?:too\s+)?(?:fancy|upscale|high[- ]end)\b/i;

const OPPOSITES = { quiet: ['lively'], relaxed: ['lively'], lively: ['quiet', 'relaxed'], casual: ['upscale'], upscale: ['casual'] };

export function vibesFromAsk(text) {
  const t = String(text ?? '');
  const want = new Set();
  const avoid = new Set();
  for (const [key, re] of Object.entries(VIBE_ASKS)) {
    for (const m of t.matchAll(new RegExp(re.source, re.flags))) {
      (NEGATION_BEFORE.test(t.slice(0, m.index)) ? avoid : want).add(key);
    }
  }
  if (NOTHING_FANCY.test(t)) want.add('casual');
  for (const k of avoid) want.delete(k);
  return { want: [...want], avoid: [...avoid] };
}

// Vibes to sink: what the person said to avoid, plus the declared opposite of what they want (unless they also want it).
export function vibesToSink({ want = [], avoid = [] } = {}) {
  const out = new Set(avoid);
  for (const k of want) for (const o of OPPOSITES[k] ?? []) if (!want.includes(o)) out.add(o);
  return [...out];
}

export const VIBE_SINK_POINTS = -1;

// A candidate's declared qualities: a gathering host's features, or a business's own attributes (its partner row, or the posting
// row's copy of them). Only what someone DECLARED; never a category.
export function declaredQualities(c) {
  const out = new Set();
  for (const list of [c?.attributes, c?.features, c?.businessPartner?.attributes, c?.matchedAvailability?.attributes]) {
    if (Array.isArray(list)) for (const k of list) out.add(k);
  }
  return [...out];
}
const declared = declaredQualities;

export function applyVibeSinks(candidates, vibes) {
  const sink = vibesToSink(vibes);
  if (!sink.length) return candidates;
  return candidates.map((c) => (declared(c).some((k) => sink.includes(k)) ? { ...c, score: (c.score ?? 0) + VIBE_SINK_POINTS } : c));
}

// "Relaxed · Quiet": every declared vibe that matched the ask, in VIBES order.
export function matchedVibeLabels(declaredKeys, wanted) {
  const d = Array.isArray(declaredKeys) ? declaredKeys : [];
  return VIBES.filter((v) => wanted.includes(v.key) && d.includes(v.key)).map((v) => v.label);
}

// Item 85: a date is described by what kind of place, not a category. "Romantic + quiet + $ + tonight + 2 people" is scored on
// the qualities an owner DECLARED, so a coffee shop its owner marked date-friendly or romantic can be a real date recommendation.
export function isDateAsk({ partyType = null, occasion = null } = {}) {
  return partyType === 'date' || occasion === 'date_night' || occasion === 'first_date';
}

// A date is two people unless the words say otherwise ("double date" = 4). Only fills a missing size; never overrides one.
export function datePartySize(text, { partyType = null, occasion = null, partySize = null } = {}) {
  if (partySize != null || !isDateAsk({ partyType, occasion })) return partySize;
  return /\bdouble[- ]date\b/i.test(String(text ?? '')) ? 4 : 2;
}

export function dateFrame({ occasion = null, dateWindow = null } = {}) {
  if (occasion === 'first_date') return 'First date';
  if (occasion === 'date_night' || dateWindow === 'tonight') return 'Date night';
  return 'A date';
}

export const QUALITY_DEPTH_POINTS = 1;
export const QUALITY_DEPTH_MAX = 2;

// The existing attribute overlap credits ANY match once. A place matching more of what was asked ranks above one matching a
// single quality: +1 per additional declared match, capped at +2. Ranking only.
export function applyQualityDepth(candidates, asked) {
  if (!Array.isArray(asked) || asked.length < 2) return candidates;
  return candidates.map((c) => {
    const n = declared(c).filter((k) => asked.includes(k)).length;
    const extra = Math.min(Math.max(n - 1, 0) * QUALITY_DEPTH_POINTS, QUALITY_DEPTH_MAX);
    return extra ? { ...c, score: (c.score ?? 0) + extra } : c;
  });
}

// "Date night at Coastal Coffee?": for a date ask, a BUSINESS result whose owner declared it date-friendly or romantic is
// offered as a date, as a question (a suggestion, never a claim). Title only; score untouched (the qualities already scored).
export function frameDatePlaces(candidates, { isDate = false, frame = 'A date', businessTypes = [] } = {}) {
  if (!isDate) return candidates;
  return candidates.map((c) => {
    if (!businessTypes.includes(c?.type)) return c;
    const name = c.businessPartner?.name ?? c.matchedAvailability?.partnerName ?? null;
    if (!name || !declared(c).some((k) => DATE_PLACE_KEYS.includes(k))) return c;
    return { ...c, title: `${frame} at ${name}?`, dateFit: true };
  });
}
