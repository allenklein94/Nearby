// Owner item 35 (2026-10-11): what the person said after an experience ("How was it?", constants/satisfactionScale.js) shapes
// what Nearby recommends next, both ways. Explicit feedback > guessing.
//
// ONE source: get_my_experience_feedback (migration 20270295) returns the person's LATEST word on each host, business and kind
// of experience: loved (Loved it / Good, unless they said they would not go again) or Not for me. A newer Okay clears an older
// word. This module is the one reader every ranking surface uses (Home's candidate pool + Picked For You, Discover's gathering
// ladder, typed asks); no surface interprets the feedback tables itself.
//
//   - Most specific wins: the host's (or business's) own word beats the word on the kind; one decision per item, never stacked.
//   - Loved lifts by FEEDBACK_POINTS, Not for me lowers by the same, in the personal-interest tier (6), scaled by account
//     maturity (owner, 2026-10-11: a single rating from a new account with little other data must not carry full weight;
//     TRANSACTIONAL, signalSourceMaturity.js; unknown maturity = full, the shared weightSignal rule). At the same maturity it
//     still outweighs learned behavior (5 x m > 4 x m), and for a mature account a declared interest the person then called
//     Not for me nets to neutral (ranked like any other category).
//   - It REORDERS only: nothing is hidden, filtered or removed, and no hard constraint or ask is overridden.
//   - Loved says why ("You loved this kind of experience last time"); Not for me never shows a reason (the item just ranks lower).
//   - A kind called Not for me also cancels the learned-behavior lift for that kind (`dropsLearned`): the person's explicit word
//     beats Nearby's guess from their activity.
import { EXPLICIT_POINTS } from '../constants/blendedRanking';
import { SIGNAL_SOURCES, weightSignal } from '../constants/signalSourceMaturity';
import { reasonText, appendReason } from '../constants/recommendationReasonVocabulary';

export const FEEDBACK_POINTS = EXPLICIT_POINTS;

export const EMPTY_EXPERIENCE_FEEDBACK = Object.freeze({
  lovedHosts: new Set(), lovedPartners: new Set(), lovedKinds: new Set(),
  notForMeHosts: new Set(), notForMePartners: new Set(), notForMeKinds: new Set(),
});

// RPC row -> the Sets every surface reads. Anything missing = empty (no feedback = ranking unchanged).
export function experienceFeedbackFromRow(row) {
  const set = (v) => new Set(Array.isArray(v) ? v.filter(Boolean) : []);
  return {
    lovedHosts: set(row?.loved_host_ids), lovedPartners: set(row?.loved_partner_ids), lovedKinds: set(row?.loved_categories),
    notForMeHosts: set(row?.not_for_me_host_ids), notForMePartners: set(row?.not_for_me_partner_ids), notForMeKinds: set(row?.not_for_me_categories),
  };
}

const NONE = Object.freeze({ direction: 0, scope: null, reason: null, dropsLearned: false });

// item: { hostId, partnerId, category }. Returns { direction: 1 | -1 | 0, scope: 'host' | 'business' | 'kind' | null,
// reason: canonical English reason text or null, dropsLearned }.
export function feedbackFor({ hostId = null, partnerId = null, category = null } = {}, feedback = null) {
  if (!feedback) return NONE;
  const has = (s, v) => v != null && s instanceof Set && s.has(v);
  const kindNotForMe = has(feedback.notForMeKinds, category);
  if (has(feedback.notForMeHosts, hostId)) return { direction: -1, scope: 'host', reason: null, dropsLearned: kindNotForMe };
  if (has(feedback.lovedHosts, hostId)) return { direction: 1, scope: 'host', reason: reasonText('lovedHost'), dropsLearned: kindNotForMe };
  if (has(feedback.notForMePartners, partnerId)) return { direction: -1, scope: 'business', reason: null, dropsLearned: kindNotForMe };
  if (has(feedback.lovedPartners, partnerId)) return { direction: 1, scope: 'business', reason: reasonText('lovedBusiness'), dropsLearned: kindNotForMe };
  if (kindNotForMe) return { direction: -1, scope: 'kind', reason: null, dropsLearned: true };
  if (has(feedback.lovedKinds, category)) return { direction: 1, scope: 'kind', reason: reasonText('lovedKind'), dropsLearned: false };
  return NONE;
}

// The weight of one feedback word for this account: FEEDBACK_POINTS scaled by maturity (the one place this is decided).
export function feedbackWeight(maturity = null, points = FEEDBACK_POINTS) {
  return weightSignal(points, SIGNAL_SOURCES.TRANSACTIONAL, maturity);
}

// The ranked delta (personal-interest tier) for an item.
export function feedbackPoints(item, feedback, maturity = null) {
  return feedbackFor(item, feedback).direction * feedbackWeight(maturity);
}

// The three loved reasons, so a ranker that counts reason lines does not count the feedback twice.
export const LOVED_REASONS = Object.freeze(['lovedHost', 'lovedBusiness', 'lovedKind'].map((k) => reasonText(k)));

// Typed asks (services/intentResolver.js, pass `experience_feedback`): the same rules as the learned affinity (utils/
// learnedAffinity.js). Only results the ask already returned are touched. Counted as HISTORY (historyScore), so the
// session-intent pass still moves it out of the score when the ask states a mood; when the ask states ANY explicit constraint
// it is a LITERAL tie-breaker (learnedTieBreak, comparePersonalTieBreak) and never moves a result past a better match.
export function applyExperienceFeedback(candidates, feedback, { constrained = false, maturity = null } = {}) {
  if (!Array.isArray(candidates) || !feedback) return candidates;
  return candidates.map((c) => {
    const fb = feedbackFor({ hostId: c?.host_id ?? null, partnerId: c?.partnerId ?? c?.hostingPartnerId ?? null, category: c?.category ?? null }, feedback);
    if (fb.direction === 0) return c;
    const delta = fb.direction * feedbackWeight(maturity);
    if (delta === 0) return c;
    const reasons = fb.reason ? appendReason(c.reasons, fb.reason) : c.reasons;
    if (constrained) return { ...c, learnedTieBreak: (Number.isFinite(c.learnedTieBreak) ? c.learnedTieBreak : 0) + delta, reasons };
    return {
      ...c,
      score: (c.score ?? 0) + delta,
      historyScore: (Number.isFinite(c.historyScore) ? c.historyScore : 0) + delta,
      reasons,
    };
  });
}
