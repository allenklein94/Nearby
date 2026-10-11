// The ONE "How was it?" scale (owner item 34, 2026-10-11: standardize feedback, never a second slightly different scale).
// Gathering feedback (gathering_feedback.satisfaction_rating) and business-offer outcomes (OfferOutcomeModal) both store these
// four values, so answers stay comparable over time. maybeRequestAppReview stays keyed to 'loved_it'.
// Labels: gatherings read ui.gatheringParts.<labelKey>, offers ui.requestDetail.outcome.satisfaction.<value>.
export const SATISFACTION_SCALE = [
  { value: 'loved_it', emoji: '😊', labelKey: 'lovedIt' },
  { value: 'good', emoji: '🙂', labelKey: 'good' },
  { value: 'okay', emoji: '😐', labelKey: 'okay' },
  { value: 'not_for_me', emoji: '🙁', labelKey: 'notForMe' },
];
