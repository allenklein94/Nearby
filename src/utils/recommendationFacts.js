// Universal recommendation-card rule (2026-09-20, owner item 33): every recommendation answers three questions on
// the card itself -- WHY (a specific, checkable reason, never bare "Matches your interests"), HOW FAR, and WHEN.
//   Because you like Coffee
//   1.3 mi · Today · 6:30 PM
// Each part appears only when it is real: no distance without a measured distance, no reason without a real signal.
import { becauseYouLikeReason } from '../constants/recommendationReasonVocabulary';
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
