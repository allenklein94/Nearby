// Owner item 45 (2026-10-11): the search "understanding" moment. What Nearby read from a typed ask, as a few quiet chips
// ("Tonight · 🌳 Outdoor") that appear as soon as the ask is understood and stay above its results. The ONE place that decides
// which pieces show; Home and Discover render them through components/AskUnderstoodChips.js.
// Rules: only what the person's words really gave (the resolver's own classification, and the environment from the same
// parseAskFacets the resolver uses); unknown = no chip, never a guess; nothing a refinement chip already shows (with friends /
// date / solo / under $25 are item 107's selected chips, so they never repeat here); no vibe words ("fun" has no chip).
// Order follows the six dimensions: WHAT, WHEN, WHERE, WHO.
import { parseAskFacets } from '../constants/askFacets';

export const UNDERSTOOD_WINDOWS = ['now', 'today', 'tonight', 'tomorrow', 'weekend'];
// Party types the refinement chips do not cover (theirs: friends, date, solo).
export const UNDERSTOOD_PARTIES = ['groups', 'family', 'coworkers', 'new_people'];

// -> [{ key: 'what', category } | { key: 'what', group } | { key: 'when', window } | { key: 'where', environment } | { key: 'who', party }]
export function understoodPieces(classifyResult, typedText) {
  const c = classifyResult ?? {};
  // An "unclear" intent still shows what WAS read: the deterministic classifier (production while AI is down) calls "something
  // fun outside tonight" unclear (no category) although it read the time and the environment and the search finds results.
  if (c.intent === 'business_partner') return [];
  const out = [];
  if (typeof c.category === 'string' && c.category) out.push({ key: 'what', category: c.category });
  else if (typeof c.narrowGroup === 'string' && c.narrowGroup) out.push({ key: 'what', group: c.narrowGroup });
  if (UNDERSTOOD_WINDOWS.includes(c.dateWindow)) out.push({ key: 'when', window: c.dateWindow });
  // The resolver's own facets when it reports them, else the same parser on the same words.
  const env = c.structured?.facets?.environment !== undefined ? c.structured.facets.environment : parseAskFacets(typedText).environment;
  if (env === 'outdoor' || env === 'indoor') out.push({ key: 'where', environment: env });
  if (UNDERSTOOD_PARTIES.includes(c.partyType)) out.push({ key: 'who', party: c.partyType });
  return out;
}

// One play per understood ask: the same words read the same way never replay (a refine, a re-render, the loader handing over
// to the results). Session memory only.
const played = new Set();
export function understoodKey(pieces, typedText) {
  return `${String(typedText ?? '').trim().toLowerCase()}|${pieces.map((p) => `${p.key}:${p.category ?? p.group ?? p.window ?? p.environment ?? p.party}`).join(',')}`;
}
export function takeUnderstoodPlay(key) {
  if (!key || played.has(key)) return false;
  played.add(key);
  return true;
}
export function _resetUnderstoodPlays() { played.clear(); }
