// Owner item 45 (2026-10-11): the search "understanding" moment. What Nearby read from a typed ask, as a few quiet chips
// ("Tonight · 🌳 Outdoor") that appear as soon as the ask is understood and stay above its results. The ONE place that decides
// which pieces show; Home and Discover render them through components/AskUnderstoodChips.js.
// Rules: only what the person's words really gave (the resolver's own classification, and the environment from the same
// parseAskFacets the resolver uses); unknown = no chip, never a guess; nothing a refinement chip already shows (with friends /
// date / solo / under $25 are item 107's selected chips, so they never repeat here); no vibe words ("fun" has no chip).
// Order follows the six dimensions: WHAT, WHEN, WHERE, WHO (the party, then the People count).
// Owner (2026-10-15, reopens item 45 narrowly): a People chip ("4 people") only when the words stated a number (item 84's
// statedPartySize; a date's assumed 2 never shows). Each chip on a results list can be REMOVED (never changed): its X re-runs
// the same ask in place without that piece through the refine path (services/askRefine.js, recorded as a refinement). The
// classification remembers what was removed (`removedUnderstood`) so the resolver never reads it back from the same words.
import { parseAskFacets } from '../constants/askFacets';
import { statedPartySize } from './askResolver';

export const UNDERSTOOD_WINDOWS = ['now', 'today', 'tonight', 'tomorrow', 'weekend'];
// Party types the refinement chips do not cover (theirs: friends, date, solo).
export const UNDERSTOOD_PARTIES = ['groups', 'family', 'coworkers', 'new_people'];

export const UNDERSTOOD_KEYS = ['what', 'when', 'where', 'who', 'people'];

// The pieces removed from this ask by the person (a Set of UNDERSTOOD_KEYS); the resolver reads the same list.
export function removedUnderstood(classifyResult) {
  const r = classifyResult?.removedUnderstood;
  return new Set(Array.isArray(r) ? r.filter((k) => UNDERSTOOD_KEYS.includes(k)) : []);
}

// The People count the words stated, from the ask's CURRENT size (a removal clears it) and the original reading's sources.
function statedCount(c, typedText) {
  return statedPartySize({ group: { partySize: c.partySize }, sources: c.structured?.sources }, typedText);
}

// -> [{ key: 'what', category } | { key: 'what', group } | { key: 'when', window } | { key: 'where', environment } | { key: 'who', party }
//     | { key: 'people', count }]
export function understoodPieces(classifyResult, typedText) {
  const c = classifyResult ?? {};
  const removed = removedUnderstood(c);
  // An "unclear" intent still shows what WAS read: the deterministic classifier (production while AI is down) calls "something
  // fun outside tonight" unclear (no category) although it read the time and the environment and the search finds results.
  if (c.intent === 'business_partner') return [];
  const out = [];
  if (typeof c.category === 'string' && c.category) out.push({ key: 'what', category: c.category });
  else if (typeof c.narrowGroup === 'string' && c.narrowGroup) out.push({ key: 'what', group: c.narrowGroup });
  if (UNDERSTOOD_WINDOWS.includes(c.dateWindow)) out.push({ key: 'when', window: c.dateWindow });
  // The resolver's own facets when it reports them, else the same parser on the same words.
  const env = c.structured?.facets?.environment !== undefined ? c.structured.facets.environment : parseAskFacets(typedText).environment;
  if (!removed.has('where') && (env === 'outdoor' || env === 'indoor')) out.push({ key: 'where', environment: env });
  if (UNDERSTOOD_PARTIES.includes(c.partyType)) out.push({ key: 'who', party: c.partyType });
  const count = statedCount(c, typedText);
  if (count != null) out.push({ key: 'people', count });
  return out;
}

// Remove one understood piece: the classification without it, plus the key in `removedUnderstood` so the same words cannot
// bring it back. Everything else in the ask (other pieces, refinement chips, the words) is kept as it is.
export function removeUnderstoodPiece(classifyResult, key) {
  const c = { ...(classifyResult ?? {}) };
  if (!UNDERSTOOD_KEYS.includes(key)) return c;
  if (key === 'what') c.category = null; // a Browse group (item 108) is the rail's own choice: services/askRefine.js clears it there
  if (key === 'when') c.dateWindow = null;
  if (key === 'who') c.partyType = null;
  if (key === 'people') c.partySize = null;
  c.removedUnderstood = [...new Set([...removedUnderstood(c), key])];
  return c;
}

// One play per understood ask: the same words read the same way never replay (a refine, a re-render, the loader handing over
// to the results). Session memory only.
const played = new Set();
export function understoodKey(pieces, typedText) {
  return `${String(typedText ?? '').trim().toLowerCase()}|${pieces.map((p) => `${p.key}:${p.category ?? p.group ?? p.window ?? p.environment ?? p.party ?? p.count}`).join(',')}`;
}
export function takeUnderstoodPlay(key) {
  if (!key || played.has(key)) return false;
  played.add(key);
  return true;
}
export function _resetUnderstoodPlays() { played.clear(); }
