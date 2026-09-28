// Owner item 60: never say "you like X" unless the person really has X. A match is a structured result the UI renders,
// not a string a surface invents:
//   match_type   'declared_interest' (X is in the person's own interests) | 'recent_activity' (their own history, never
//                declared) | 'none'
//   match_value  the tag the match was computed on (the gathering's/offer's own tag)
//   match_reason the sentence to show, or null when there is no real match (render nothing)
//   confidence   'high' for a declared interest, 'medium' for activity only, 'low' for a tag only RELATED to a declared hobby
//                (hobbyRelations.js: "Related to your interest in Photography", never "you like"), null for none
import { canonicalizeInterests } from '../constants/interestGraph';
import { relatedHobbyFor, relatedInterestReason } from '../constants/hobbyRelations';
import { reasonText } from '../constants/recommendationReasonVocabulary';

export const MATCH_TYPES = { DECLARED: 'declared_interest', ACTIVITY: 'recent_activity', RELATED: 'related_interest', NONE: 'none' };

export function interestMatch(tag, { declared = [], activity = [] } = {}) {
  const value = typeof tag === 'string' ? tag.trim() : '';
  const none = { match_type: MATCH_TYPES.NONE, match_value: value || null, match_reason: null, confidence: null };
  if (!value) return none;
  if (canonicalizeInterests(declared).includes(value)) {
    return { match_type: MATCH_TYPES.DECLARED, match_value: value, match_reason: reasonText('becauseYouLike', { category: value }), confidence: 'high' };
  }
  if ((activity ?? []).includes(value)) {
    return { match_type: MATCH_TYPES.ACTIVITY, match_value: value, match_reason: reasonText('recentActivity', { category: value }), confidence: 'medium' };
  }
  const hobby = relatedHobbyFor(value, declared);
  if (hobby) {
    return { match_type: MATCH_TYPES.RELATED, match_value: value, match_reason: relatedInterestReason(hobby), confidence: 'low' };
  }
  return none;
}
