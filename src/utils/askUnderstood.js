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
// Owner idea "307" (2026-10-20, reopens decision 3 narrowly): WHEN and People can also be CHANGED in place (Tonight -> Tomorrow,
// 4 -> 6) to one of their existing choices; the ask re-runs through the same refine path. The classification remembers what
// was changed (`changedUnderstood`): the chosen value replaces the words' reading everywhere (the resolver stops reading the
// words' time for a changed WHEN; Create and AskBusiness carry the chosen value). WHAT, WHERE and WHO stay remove-only.
// Owner idea "306" (2026-10-22): the clock time the words gave is a chip too ("After 7 PM"), only when the search really used it
// (`askClock`: a window anchored to a stated day, or a need's "at 7"); it can be removed or switched to the same time AM/PM
// (7 PM <-> 7 AM), never to another hour; noon / midnight are remove-only. The resolver and AskBusiness read the same reading.
import { parseAskFacets } from '../constants/askFacets';
import { statedPartySize } from './askResolver';
import { clockWindowFromText, dateAnchorFromText, pointClockFromText } from '../constants/clockWindow';
import { askKind } from './needAsk';

export const UNDERSTOOD_WINDOWS = ['now', 'today', 'tonight', 'tomorrow', 'weekend'];
// Party types the refinement chips do not cover (theirs: friends, date, solo).
export const UNDERSTOOD_PARTIES = ['groups', 'family', 'coworkers', 'new_people'];

export const UNDERSTOOD_KEYS = ['what', 'when', 'clock', 'where', 'who', 'people'];
// Idea "307": the pieces that can be changed, and their choices (WHEN = the windows above; People = a headcount incl. the person).
export const UNDERSTOOD_CHANGEABLE = ['when', 'clock', 'people'];
export const UNDERSTOOD_PEOPLE_CHOICES = [2, 3, 4, 5, 6, 7, 8, 10, 12];

// The pieces removed from this ask by the person (a Set of UNDERSTOOD_KEYS); the resolver reads the same list.
export function removedUnderstood(classifyResult) {
  const r = classifyResult?.removedUnderstood;
  return new Set(Array.isArray(r) ? r.filter((k) => UNDERSTOOD_KEYS.includes(k)) : []);
}

// The pieces the person changed on the results (a Set of UNDERSTOOD_CHANGEABLE).
export function changedUnderstood(classifyResult) {
  const r = classifyResult?.changedUnderstood;
  return new Set(Array.isArray(r) ? r.filter((k) => UNDERSTOOD_CHANGEABLE.includes(k)) : []);
}

// The People count the words stated, from the ask's CURRENT size (a removal clears it) and the original reading's sources.
// A changed People chip is the person's own choice, so it counts as stated.
function statedCount(c, typedText) {
  if (changedUnderstood(c).has('people')) return Number.isInteger(c.partySize) && c.partySize > 0 ? c.partySize : null;
  return statedPartySize({ group: { partySize: c.partySize }, sources: c.structured?.sources }, typedText);
}

// ---- idea "306": the clock time ----
// A reading = { after, before } (a window, either side may be null) or { at } (one moment), minutes after midnight.
const isMinute = (m) => Number.isInteger(m) && m >= 0 && m <= 24 * 60;
function validClock(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.at != null) return isMinute(r.at) ? { at: r.at } : null;
  const after = r.after ?? null;
  const before = r.before ?? null;
  if ((after != null && !isMinute(after)) || (before != null && !isMinute(before))) return null;
  if (after == null && before == null) return null;
  if (after != null && before != null && before <= after) return null;
  return { after, before };
}

// The clock reading the search uses for this ask: undefined = read the words (nothing removed or chosen), null = none, else the
// person's choice. A removed or changed WHEN drops the words' clock too (idea "307": the time belonged to the old day).
export function clockOverride(classifyResult) {
  const c = classifyResult ?? {};
  const removed = removedUnderstood(c);
  if (removed.has('when') || removed.has('clock') || changedUnderstood(c).has('when')) return null;
  if (changedUnderstood(c).has('clock')) return validClock(c.clockChoice);
  return undefined;
}

// The clock reading the search really USES, or null: a window only once the words anchor it to a day (constants/clockWindow.js),
// a single time only for a need (utils/needAsk.js 1b: on one named day, or no day said). The same rules the resolver applies.
export function askClock(classifyResult, typedText) {
  const c = classifyResult ?? {};
  const text = String(typedText ?? '');
  const o = clockOverride(c);
  if (o === null) return null;
  const reading = o ?? validClock(clockWindowFromText(text)) ?? (pointClockFromText(text) != null ? { at: pointClockFromText(text) } : null);
  if (!reading) return null;
  const anchor = dateAnchorFromText(text);
  if (reading.at == null) return anchor ? reading : null;
  const oneDay = anchor?.kind === 'day' && anchor.dates?.length === 1;
  return askKind({ category: c.category ?? null, rawText: text }) === 'need' && (oneDay || !anchor) ? reading : null;
}

// The same time on the other half of the day (7 PM -> 7 AM), or null: noon and midnight have no other half, and a range that
// would no longer run forward ("11 AM to 2 PM") is not flipped.
const flipMinute = (m) => (m == null ? null : m === 0 || m === 12 * 60 || m === 24 * 60 ? undefined : m < 12 * 60 ? m + 12 * 60 : m - 12 * 60);
export function flipClock(r) {
  const v = validClock(r);
  if (!v) return null;
  if (v.at != null) { const at = flipMinute(v.at); return at === undefined ? null : { at }; }
  const after = flipMinute(v.after);
  const before = flipMinute(v.before);
  if (after === undefined || before === undefined) return null;
  return validClock({ after, before });
}

const clockMinutes = (r) => (r.at ?? r.after ?? r.before);
export function sameClock(a, b) {
  return !!a && !!b && (a.at ?? null) === (b.at ?? null) && (a.after ?? null) === (b.after ?? null) && (a.before ?? null) === (b.before ?? null);
}

// -> [{ key: 'what', category } | { key: 'what', group } | { key: 'when', window } | { key: 'where', environment } | { key: 'who', party }
//     | { key: 'clock', clock } | { key: 'people', count }]
// The ONE People count an ask carries (the chip, Create's People, the request's carried row): stated or chosen, else null.
export function understoodPartySize(classifyResult, typedText) {
  return statedCount(classifyResult ?? {}, typedText);
}

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
  const clock = askClock(c, typedText);
  if (clock) out.push({ key: 'clock', clock });
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
  if (key === 'clock') delete c.clockChoice;
  c.removedUnderstood = [...new Set([...removedUnderstood(c), key])];
  if (Array.isArray(c.changedUnderstood)) c.changedUnderstood = c.changedUnderstood.filter((k) => k !== key);
  return c;
}

// The choices a changeable piece offers (the current one included), [] for a remove-only piece.
export function understoodChoices(piece) {
  if (piece?.key === 'when') return UNDERSTOOD_WINDOWS;
  if (piece?.key === 'clock') {
    const other = flipClock(piece.clock);
    return other ? [piece.clock, other].sort((a, b) => clockMinutes(a) - clockMinutes(b)) : [];
  }
  if (piece?.key === 'people') return [...new Set([...UNDERSTOOD_PEOPLE_CHOICES, piece.count])].sort((a, b) => a - b);
  return [];
}

// Change one understood piece to one of its choices: the classification with the new value, plus the key in
// `changedUnderstood`. Anything else (or the same value) leaves the classification as it is.
export function changeUnderstoodPiece(classifyResult, key, value, typedText = '') {
  const c = { ...(classifyResult ?? {}) };
  if (key === 'when' && UNDERSTOOD_WINDOWS.includes(value) && value !== c.dateWindow) c.dateWindow = value;
  else if (key === 'people' && Number.isInteger(value) && value > 0 && value !== c.partySize) c.partySize = value;
  else if (key === 'clock') {
    // Only the current reading's own AM/PM twin: never another hour, never a clock the search would not use.
    const current = askClock(c, typedText);
    if (!current || !sameClock(flipClock(current), value)) return c;
    c.clockChoice = validClock(value);
  } else return c;
  c.changedUnderstood = [...new Set([...changedUnderstood(c), key])];
  return c;
}

// One play per understood ask: the same words read the same way never replay (a refine, a re-render, the loader handing over
// to the results). Session memory only.
const played = new Set();
export function understoodKey(pieces, typedText) {
  const val = (p) => (p.clock ? `${p.clock.at ?? ''}/${p.clock.after ?? ''}/${p.clock.before ?? ''}` : p.category ?? p.group ?? p.window ?? p.environment ?? p.party ?? p.count);
  return `${String(typedText ?? '').trim().toLowerCase()}|${pieces.map((p) => `${p.key}:${val(p)}`).join(',')}`;
}
export function takeUnderstoodPlay(key) {
  if (!key || played.has(key)) return false;
  played.add(key);
  return true;
}
export function _resetUnderstoodPlays() { played.clear(); }
