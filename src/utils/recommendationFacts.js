// Universal recommendation-card rule (2026-09-20, owner item 33): every recommendation answers three questions on
// the card itself -- WHY (a specific, checkable reason, never bare "Matches your interests"), HOW FAR, and WHEN.
//   Because you like Coffee
//   1.3 mi · Today · 6:30 PM
// Each part appears only when it is real: no distance without a measured distance, no reason without a real signal.
import { becauseYouLikeReason, categorizeReasonText, REASON_CATEGORIES } from '../constants/recommendationReasonVocabulary';
import { formatHeroDateTime } from './timeContext';

export function formatDistance(miles) {
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) return null;
  return miles < 0.1 ? 'Very close' : `${miles.toFixed(1)} mi`;
}

export function recommendationFacts(g) {
  if (!g) return { why: null, distance: null, when: null, meta: null };
  const interestMatched = g.matchesYourInterests === true || (typeof g.matchScore === 'number' && g.matchScore > 0);
  const why = interestMatched ? becauseYouLikeReason(g.interest_tag) : (g.reasons?.[0] ?? null);
  const distance = formatDistance(g.distanceMiles);
  const when = g.scheduled_at ? formatHeroDateTime(g.scheduled_at) : null;
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
