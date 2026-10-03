// Session intent (owner item 114, 2026-09-27): what the person is trying to accomplish RIGHT NOW outranks who they usually are.
// "I love nightlife" is history; "tonight I want something quiet" is the session intent, and it wins.
//   Explicit current intent > historical preference.
//
// The session intent is only what THIS ask's own words state about the kind of plan: a vibe to have or avoid (quiet, lively,
// nothing fancy; constants/businessVibes.js) or an energy (low-key, high-energy, active; constants/energyLevel.js). Never AI,
// never stored, never written to a profile; it lives only as long as the ask (item 113 ends a timed ask).
//
// Historical preference in a typed ask = the lifts a result gets from the PERSON rather than the ask: a gathering matching a
// declared interest (base_interest_match), a business they booked before or follow, a hobby link. Each candidate carries that
// sum as `historyScore`. When the ask states a session intent:
//   - a result that CONFLICTS with it (declared a vibe the ask avoids / the opposite of one it wants, or a clear energy
//     opposite) keeps NO history lift, so "you like nightlife" can never carry a lively bar over "something quiet";
//   - every other result keeps at most HISTORY_TIEBREAK (1) of it: history may still break a tie, never outweigh a stated
//     quality (the smallest ask-specific lift is 2).
// No session intent = history untouched. Ranking only; nothing is removed.
import { vibesFromAsk, vibesToSink, declaredQualities } from './businessVibes';
import { energiesFromText, energyFit } from './energyLevel';

export const HISTORY_TIEBREAK = 1;

export function sessionIntentFromText(text) {
  const vibes = vibesFromAsk(text);
  const energies = energiesFromText(text);
  const active = vibes.want.length > 0 || vibes.avoid.length > 0 || energies.length > 0;
  return { active, vibes, sinkVibes: vibesToSink(vibes), energies };
}

export function conflictsWithSessionIntent(c, intent) {
  if (!intent?.active) return false;
  if (intent.sinkVibes.length && declaredQualities(c).some((k) => intent.sinkVibes.includes(k))) return true;
  if (intent.energies.length && energyFit(c?.category, intent.energies, c?.hostEnergy).delta < 0) return true;
  return false;
}

export function applySessionIntent(candidates, intent) {
  if (!intent?.active || !Array.isArray(candidates)) return candidates;
  return candidates.map((c) => {
    const history = Number.isFinite(c?.historyScore) ? c.historyScore : 0;
    const conflict = conflictsWithSessionIntent(c, intent);
    // a learned tie-break (item 156 under a stated constraint) is history too: a conflicting result keeps none of it
    if (conflict && c?.learnedTieBreak) c = { ...c, learnedTieBreak: 0 };
    if (history <= 0) return c;
    const keep = conflict ? 0 : Math.min(history, HISTORY_TIEBREAK);
    if (keep === history) return c;
    return { ...c, score: (c.score ?? 0) - history + keep, historyScore: keep };
  });
}
