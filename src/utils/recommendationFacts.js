import { gatheringWhen } from './timeWindow';
import { canonicalizeInterests } from '../constants/interestGraph';
// Universal recommendation-card rule (2026-09-20, owner item 33): every recommendation answers three questions on
// the card itself -- WHY (a specific, checkable reason, never bare "Matches your interests"), HOW FAR, and WHEN.
//   Because you like Coffee
//   1.3 mi · Today · 6:30 PM
// Each part appears only when it is real: no distance without a measured distance, no reason without a real signal.
import { becauseYouLikeReason, categorizeReasonText, REASON_CATEGORIES } from '../constants/recommendationReasonVocabulary';
import { formatHeroDateTime } from './timeContext';
import { formatDistance } from './formatDistance';

// The one distance format lives in utils/formatDistance.js (re-exported for existing callers).
export { formatDistance };

export function recommendationFacts(g) {
  if (!g) return { why: null, distance: null, when: null, meta: null };
  const interestMatched = g.matchesYourInterests === true || (typeof g.matchScore === 'number' && g.matchScore > 0);
  // A distance/time reason ("Happening today") is the WHEN/WHERE fact, shown once as the measured meta line, never as the WHY.
  const restated = [REASON_CATEGORIES.DISTANCE, REASON_CATEGORIES.TIME];
  const firstWhy = (g.reasons ?? []).find((r) => !restated.includes(categorizeReasonText(r))) ?? null;
  const why = interestMatched ? becauseYouLikeReason(g.interest_tag) : firstWhy;
  const distance = formatDistance(g.distanceMiles);
  const when = g.scheduled_at ? gatheringWhen(g) : null;
  return { why, distance, when, meta: [distance, when].filter(Boolean).join(' · ') || null };
}

// "1.3 mi · Today · 6:30 PM" for surfaces that already format their own time wording (e.g. Discover's "Tonight").
export function factsMeta(g, when = null) {
  const parts = [formatDistance(g?.distanceMiles), when ?? (g?.scheduled_at ? formatHeroDateTime(g.scheduled_at) : null)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// A "Nearby Right Now" row ({ type, reasons, data }): reasons that are only distance/time ("Close by", "Happening
// today") are the HOW-FAR / WHEN facts, so they show once as the measured meta line rather than as a reason too.
// Every other reason is the WHY. With nothing measured to show, the reasons are shown as they are. A perk has a
// measured distance but no event time, so it never shows a time.
export function recommendationRow(item) {
  const reasons = item?.reasons ?? [];
  const meta = factsMeta(item?.data);
  if (!meta) return { why: reasons.join(' · ') || null, meta: null };
  const restated = [REASON_CATEGORIES.DISTANCE, REASON_CATEGORIES.TIME];
  const why = reasons.filter((r) => !restated.includes(categorizeReasonText(r)));
  return { why: why.join(' · ') || null, meta };
}

// "Sam is going" / "Sam and Alex are going" / "Sam, Alex and 2 more friends are going": connected FRIENDS (never a
// stranger, never yourself) who are approved attendees of this gathering. `friendIds` is a Set of the viewer's
// accepted friends. Null when no friend is going -- no reason is invented.
export function friendGoingReason(g, friendIds, myUserId = null) {
  if (!friendIds || friendIds.size === 0) return null;
  const going = (g?.approvedAttendees ?? []).filter((a) => a?.user_id && a.user_id !== myUserId && friendIds.has(a.user_id));
  if (going.length === 0) return null;
  const names = going.map((a) => a.profiles?.display_name).filter(Boolean);
  if (names.length === 0) return going.length === 1 ? 'A friend is going' : `${going.length} friends are going`;
  const others = going.length - Math.min(names.length, 2);
  if (going.length === 1) return `${names[0]} is going`;
  if (others <= 0) return `${names[0]} and ${names[1]} are going`;
  return `${names[0]}, ${names[1]} and ${others} more friend${others === 1 ? '' : 's'} are going`;
}

// A community card's WHY: named only when its own interest tag is one the person really declared. No declared match =
// no reason (never a generic "Matches your interests"); the card then shows only its measured distance/description.
export function communityReason(community, declaredInterests) {
  const tag = community?.interest_tag;
  if (!tag) return null;
  return canonicalizeInterests(declaredInterests).includes(tag) ? becauseYouLikeReason(tag) : null;
}
