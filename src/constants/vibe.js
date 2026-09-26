// Vibe (owner item 83, 2026-09-26): what a place FEELS like -- "I want somewhere relaxed and quiet." Not a new store or taxonomy:
// a vibe is a NAMED VIEW over the one shared attribute vocabulary (businessAttributes.js), declared by the business owner, never
// inferred from its category, name, description or reviews. Same shape as business capabilities (item 80).
//
//   Casual = casual · Upscale = upscale · Romantic = romantic · Lively = lively (also what "energetic" asks for) · Quiet = quiet
//   Trendy = trendy · Family-friendly = kid_friendly · Relaxed = relaxed · Social = social · Cozy = cozy · Professional = professional
//
// Energetic is not a separate declaration: for a place, lively and energetic are the same thing to say, so both words ask for
// `lively` (the owner picks one chip). Gatherings are not given a vibe field: their host-declared Energy scale (energy_level) and
// declared features (quiet, kid_friendly) already say it, and the energy pass (energyLevel.js) reads those.
//
// Typed asks, ranking only (never a filter; undeclared = neutral), business results only (their declared partner attributes):
//   - any asked vibe the business declared: +2, and +1 more when it declared EVERY asked vibe ("relaxed and quiet" prefers a place
//     that said both); the reason names what matched ("Relaxed and quiet").
//   - a clear opposite it declared (quiet/relaxed/cozy vs lively, casual vs upscale): -1.
// The words are read deterministically (never AI); a negated vibe ("nothing fancy", "not too quiet") is never asked for, and
// "nothing fancy" asks for casual. Vibes are never put in a business payload beyond what the request's attributes already carry.

export const VIBES = [
  { key: 'casual', attribute: 'casual', label: 'Casual', icon: '👕',
    ask: /\bsomewhere\s+casual\b|\bcasual\s+(?:spot|place|restaurant|bar|dinner|lunch|brunch|vibe|atmosphere|setting|night\s+out)\b|\bkeep\s+it\s+casual\b|\bdressed[- ]down\b/i },
  { key: 'upscale', attribute: 'upscale', label: 'Upscale', icon: '🎩',
    ask: /\bupscale\b|\bfancy\b|\bclassy\b|\belegant\b|\bhigh[- ]end\b|\bdressy\b|\bswanky\b|\bsomewhere\s+nice\b/i },
  { key: 'romantic', attribute: 'romantic', label: 'Romantic', icon: '🕯️',
    ask: /\bromantic\b|\bcandle[- ]?lit\b|\bintimate\b/i },
  { key: 'lively', attribute: 'lively', label: 'Lively', icon: '🎶',
    ask: /\blively\b|\bbuzzing\b|\bbuzzy\b|\bvibrant\b|\benergetic\b|\bhigh[- ]energy\b|\bgood\s+energy\b/i },
  { key: 'quiet', attribute: 'quiet', label: 'Quiet', icon: '🤫',
    ask: /\bquiet\b|\bpeaceful\b|\bcalm\b|\bwhere\s+we\s+can\s+(?:talk|hear\s+each\s+other)\b/i },
  { key: 'trendy', attribute: 'trendy', label: 'Trendy', icon: '🕶️',
    ask: /\btrendy\b|\bhip\b(?![- ]?hop)|\bstylish\b|\bchic\b|\bhot\s+new\b|\bcool\s+new\b|\bup[- ]and[- ]coming\b/i },
  { key: 'family_friendly', attribute: 'kid_friendly', label: 'Family-friendly', icon: '🧒',
    ask: /\bfamily[- ]friendly\b|\bkid[- ]friendly\b|\bkids?\s+welcome\b|\bgood\s+for\s+(?:the\s+)?(?:kids|families|children)\b/i },
  { key: 'relaxed', attribute: 'relaxed', label: 'Relaxed', icon: '🛋️',
    ask: /\brelax(?:ed|ing)\b|\blaid[- ]back\b|\bchill\b|\blow[- ]key\b|\bmellow\b|\beasy[- ]?going\b/i },
  { key: 'social', attribute: 'social', label: 'Social', icon: '🍻',
    ask: /\bsocial\b(?!\s+media)/i },
  { key: 'cozy', attribute: 'cozy', label: 'Cozy', icon: '🧣',
    ask: /\bcozy\b|\bcosy\b|\bsnug\b|\bwarm\s+and\s+inviting\b/i },
  { key: 'professional', attribute: 'professional', label: 'Professional', icon: '👔',
    ask: /\bsomewhere\s+professional\b|\bprofessional\s+(?:setting|atmosphere|vibe|place|spot|feel)\b|\b(?:client|business|work)\s+(?:meeting|lunch|dinner|breakfast|coffee)\b/i },
];

// Only the attribute keys that did not exist before this item need the vocabulary widened.
export const NEW_VIBE_ATTRIBUTE_KEYS = ['lively', 'trendy', 'relaxed', 'social', 'cozy', 'professional'];
export const VIBE_ATTRIBUTE_KEYS = [...new Set(VIBES.map((v) => v.attribute))];

// Opposite pairs, by vibe key. Symmetric; a business declaring one side is nudged down only when the other was asked.
const OPPOSITES = [['quiet', 'lively'], ['relaxed', 'lively'], ['cozy', 'lively'], ['casual', 'upscale']];
function oppositesOf(key) {
  return OPPOSITES.flatMap(([a, b]) => (a === key ? [b] : b === key ? [a] : []));
}

// A vibe word the person negated is removed before the positives are read ("not too quiet", "nothing fancy", "no trendy places").
const NEGATED = /\b(?:not|no|nothing|never|without|isn'?t|aren'?t|don'?t\s+want(?:\s+(?:it|anything|somewhere))?)\s+(?:too\s+|very\s+|that\s+|so\s+|overly\s+|super\s+|a\s+|an\s+|somewhere\s+|anywhere\s+|anything\s+)*[a-z]+(?:-[a-z]+)?/gi;
const NOT_FANCY = /\b(?:nothing|not|no)\s+(?:too\s+|very\s+|that\s+|overly\s+|super\s+)?(?:fancy|upscale|dressy|swanky)\b/i;

// Vibe keys the person's own words name, in VIBES order (empty when none).
export function vibesFromText(text) {
  if (typeof text !== 'string' || !text) return [];
  const rest = text.replace(NEGATED, ' ');
  const out = VIBES.filter((v) => v.ask.test(rest)).map((v) => v.key);
  if (NOT_FANCY.test(text) && !out.includes('casual')) out.push('casual');
  return VIBES.map((v) => v.key).filter((k) => out.includes(k));
}

export const vibeByKey = (key) => VIBES.find((v) => v.key === key) ?? null;
export const vibeAttribute = (key) => vibeByKey(key)?.attribute ?? null;
export const vibeAttributesFor = (keys) => [...new Set((Array.isArray(keys) ? keys : []).map(vibeAttribute).filter(Boolean))];

// Vibe keys behind a list of attribute keys (the AI extractor's closed-vocabulary attributes, or the ask's own).
export function vibeKeysFromAttributes(attributes) {
  const attrs = Array.isArray(attributes) ? attributes : [];
  return VIBES.filter((v) => attrs.includes(v.attribute)).map((v) => v.key);
}

// The vibes a business declared, from its own attributes (never from its category).
export function vibesOf(row) {
  const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
  return VIBES.filter((v) => attrs.includes(v.attribute));
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export const VIBE_FIT_POINTS = 2;
export const VIBE_ALL_POINTS = 1;
export const VIBE_OPPOSITE_POINTS = -1;

// { delta, reason } for one declared-attribute list against the asked vibe keys.
export function vibeFit(attributes, asked) {
  if (!Array.isArray(asked) || asked.length === 0) return { delta: 0, reason: null };
  const attrs = Array.isArray(attributes) ? attributes : [];
  if (attrs.length === 0) return { delta: 0, reason: null };
  const hits = asked.map(vibeByKey).filter((v) => v && attrs.includes(v.attribute));
  if (hits.length > 0) {
    const all = hits.length === new Set(asked).size;
    const words = hits.map((v, i) => (i === 0 ? v.label : v.label.toLowerCase()));
    return { delta: VIBE_FIT_POINTS + (all && asked.length > 1 ? VIBE_ALL_POINTS : 0), reason: joinLabels(words) };
  }
  const clash = asked.some((k) => oppositesOf(k).some((o) => attrs.includes(vibeAttribute(o))));
  return { delta: clash ? VIBE_OPPOSITE_POINTS : 0, reason: null };
}

// Ranking-only pass over resolver candidates: a business result's declared attributes come from its partner row (item 72 attaches
// it to every business result). Gatherings and perks are untouched (gatherings: the energy pass; perks: no partner row).
export function applyVibesToCandidates(candidates, asked) {
  if (!Array.isArray(asked) || asked.length === 0 || !Array.isArray(candidates)) return candidates;
  return candidates.map((c) => {
    const attrs = c?.businessPartner?.attributes;
    if (!attrs) return c;
    const { delta, reason } = vibeFit(attrs, asked);
    if (!delta) return c;
    return { ...c, score: (c.score ?? 0) + delta, ...(reason ? { vibeReason: reason, subtitle: c.subtitle ?? reason } : {}) };
  });
}
