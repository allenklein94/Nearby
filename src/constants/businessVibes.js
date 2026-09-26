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

// Word rules per vibe. Each is tested against every occurrence; an occurrence right after a negation is an AVOID.
const VIBE_ASKS = {
  casual: /\bcasual\b(?!\s+(?:game|games|date|dating|hook ?up|sex|encounter|friends?|player|level))|\bno\s+dress\s+code\b|\bcome\s+as\s+you\s+are\b/gi,
  upscale: /\b(?:upscale|fancy|high[- ]end|classy|elegant|swanky|posh|dress(?:ed)?\s+up)\b/gi,
  romantic: /\b(?:romantic|candlelit|candle[- ]lit)\b/gi,
  lively: /\b(?:lively|energetic|buzzing|vibrant|high[- ]energy)\b/gi,
  quiet: /\b(?:quiet|peaceful)\b/gi,
  trendy: /\b(?:trendy|stylish|instagrammable|hot\s+spot)\b/gi,
  kid_friendly: /\b(?:family[- ]friendly|kid[- ]friendly|child[- ]friendly)\b|\bwith\s+(?:my|our|the)\s+(?:kids|children|little\s+ones)\b/gi,
  relaxed: /\b(?:relaxed|laid[- ]back|chill|mellow|easy[- ]?going)\b/gi,
  social: /\bsocial\s+(?:spot|place|vibe|atmosphere|scene|bar|crowd)\b|\bsomewhere\s+social\b/gi,
  cozy: /\b(?:cozy|cosy|snug)\b/gi,
  professional: /\bprofessional\b(?!\s+(?:development|photographer|photography|headshots?|cleaning|services?|help|advice))|\b(?:business|client|work)\s+(?:meeting|lunch|dinner|coffee)\b|\bmeet(?:ing)?\s+(?:a|my|with\s+a)\s+client\b/gi,
};
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

// A candidate's declared vibes: a business's attributes, or a gathering host's declared features.
function declared(c) {
  return [...(Array.isArray(c?.attributes) ? c.attributes : []), ...(Array.isArray(c?.features) ? c.features : [])];
}

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
