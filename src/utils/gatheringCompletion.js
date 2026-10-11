// Owner item 34 (2026-10-11): "Plan complete". When a gathering you attended is over, its card in Home's Your Plans turns
// Confirmed -> ✓ Completed once, quietly, and asks the existing "How was it?" (constants/satisfactionScale.js) inline on that
// card. This replaced the Home pop-up that used to open on its own (GatheringFeedbackModal, removed): one prompt, in context.
//
// The rules, in one place:
//   - "Over" is the ONE temporal engine's phase (utils/timeWindow.js): start + the host's duration has passed, else the
//     shared 30-minute "just started" rule. A gathering still going is never called Completed.
//   - Only a gathering you were approved to attend (services/gatherings.js getMostRecentUnratedGathering), within 3 days,
//     with no feedback row yet. Answering OR "Skip" writes the row, so the card never comes back or duplicates.
//   - The move plays once per gathering, ever (stored ids below); afterwards the card shows the settled "Completed" badge.
//     Reduce Motion: the settled row at once (still counts as played).
// Pure: storage (AsyncStorage on the phone) is passed in by the caller.
import { timeWindowParts } from './timeWindow';
import { PLAN_STATUS } from '../constants/planStatus';

export const COMPLETION_MOMENT_KEY = 'nearby.completionMomentPlayed.v1';
// Only the most recent ids are kept (a card is only offered for 3 days, so older ids can never be asked about again).
export const COMPLETION_MOMENT_KEEP = 50;

// The card moves from what it said while upcoming (resolveGatheringPlanStatus -> Confirmed) to Completed.
export const COMPLETION_FROM = PLAN_STATUS.CONFIRMED;
export const COMPLETION_TO = PLAN_STATUS.COMPLETED;

export function isGatheringOver(gathering, now = new Date()) {
  if (!gathering?.scheduled_at) return false;
  const p = timeWindowParts({ start: gathering.scheduled_at, durationMinutes: gathering.duration_minutes ?? null }, now, 'event');
  return p.phase === 'over';
}

// The completed plan Home shows, or null: the unrated attended gathering, only once it is really over.
export function completedPlanFor(unratedGathering, now = new Date()) {
  return unratedGathering?.id && isGatheringOver(unratedGathering, now) ? unratedGathering : null;
}

// true the FIRST time it is asked for this gathering (and records it); false after that, forever. A storage failure answers
// false (the settled card, no move) rather than risk replaying it.
export async function takeCompletionMoment(gatheringId, storage) {
  if (gatheringId == null || !storage) return false;
  let list;
  try {
    const raw = await storage.getItem(COMPLETION_MOMENT_KEY);
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch {
    return false;
  }
  if (list.includes(gatheringId)) return false;
  try {
    await storage.setItem(COMPLETION_MOMENT_KEY, JSON.stringify([...list, gatheringId].slice(-COMPLETION_MOMENT_KEEP)));
  } catch {
    return false;
  }
  return true;
}
