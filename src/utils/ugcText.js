// User-content screening (migration 20270373): the ONE trim rule. The app, the edge function (screen-user-content
// normalizeText) and the database (private.ugc_norm) all trim ASCII whitespace at both ends only, so all three hash the
// same text. Guard: ugcModeration.test.js (edge source + migration carry the same pattern; journey compares hashes).
const EDGE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

export function normalizeUgcText(text) {
  return typeof text === 'string' ? text.replace(EDGE, '') : '';
}

// What each screened field is, for the classifier's context (the edge function's TEXT_KINDS). 'name' kinds are judged
// language-neutral by the database ('names' calibration row).
export const UGC_KINDS = Object.freeze({
  displayName: 'name',
  bio: 'bio',
  profileDetail: 'profile_detail',
  gatheringTitle: 'gathering_title',
  gatheringDescription: 'gathering_description',
  communityName: 'community_name',
  communityDescription: 'community_description',
  question: 'question',
  answer: 'answer',
  comment: 'comment',
});

// The server's refusals of an unscreened / not-allowed / held write (hints raised by 20270373's triggers).
export const UGC_HINTS = Object.freeze(['screening_required', 'content_not_allowed', 'content_held']);

export function ugcRefusalOf(error) {
  const hint = error?.hint || error?.details || '';
  return UGC_HINTS.find((h) => hint === h) || null;
}
