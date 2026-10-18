// Owner item 37 (2026-10-11): "Perfect Match" for activities. When the top result of a person's own typed ask really lines
// up with what they asked on several independent signals, Nearby shows it: the pieces that matched (activity, time, place),
// then "A strong match for you". Wording is item 61's ("perfect" is a claim nothing measures; owner kept "strong match").
//
// The rule (truthful, all from the ask's own structured interpretation and the result's own facts; unknown never counts):
//   activity  the ask named an activity (classifyResult.category) and the result IS that activity (same canonical tag)
//   time      the ask stated when (dateWindow, not flexible) and the result has a known start inside it
//             (matchesDateWindow, the resolver's own window; "tonight" additionally from TONIGHT_START_HOUR)
//   place     the result's real distance is known and close (< CLOSE_DISTANCE_MILES, the resolver's own "close")
// Strong = ALL THREE, and only on the result already ranked first (the "✨ Nearby Pick" slot). Fewer = no claim (the plain
// Nearby Pick badge stays). Never on a browse list, Surprise Me, a bundle, or a friend row. Ranking is untouched.
import { matchesDateWindow } from '../services/intentResolverScoring';
import { CLOSE_DISTANCE_MILES } from '../constants/distanceWillingness';
import { TONIGHT_START_HOUR } from './timeContext';
import { timeWindowParts } from './timeWindow';

export const STRONG_MATCH_PIECES = ['activity', 'time', 'place'];

function startOf(item) {
  return item?.startsAt ?? item?.postingStartsAt ?? null;
}

// -> [{ key: 'activity', value: tag }, { key: 'time', value: iso }, { key: 'place', value: miles }] or null.
export function strongMatchPieces(item, ask, now = new Date()) {
  if (!item || !ask) return null;
  const category = typeof ask.category === 'string' ? ask.category : null;
  if (!category || item.category !== category) return null;
  const dw = ask.dateWindow;
  const start = startOf(item);
  const startMs = start ? new Date(start).getTime() : NaN;
  if (!dw || dw === 'flexible' || !Number.isFinite(startMs)) return null;
  if (!matchesDateWindow(start, dw, now)) return null;
  if (dw === 'tonight' && new Date(startMs).getHours() < TONIGHT_START_HOUR) return null;
  // over: never "a match". A gathering ends by the one end rule (start + duration, else + 30 min, end exclusive; owner
  // 2026-10-17); a business posting has no end of its own here, so it keeps the 3 h "long over" cut.
  if (item.type === 'gathering') {
    if (timeWindowParts({ start, durationMinutes: item.durationMinutes ?? null }, now, 'event').phase === 'over') return null;
  } else if (startMs < now.getTime() - 3 * 3600 * 1000) return null;
  const miles = item.distanceMiles;
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0 || miles >= CLOSE_DISTANCE_MILES) return null;
  // a gathering's distance is to its privacy-shifted pin: the tick reads "About 0.3 mi" (approximate), a business's is exact
  return [{ key: 'activity', value: category }, { key: 'time', value: start }, { key: 'place', value: miles, approximate: item.type === 'gathering' }];
}
