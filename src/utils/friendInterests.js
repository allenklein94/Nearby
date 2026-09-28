// "Friends who like Coffee" (owner sign-off, 2026-09-21). Accepted friends only (the server function get_friends_interested_in
// enforces it, blocks included); a friend's interest is worded as what it is ("Sam is into Coffee"), never as the viewer's own
// taste and never as a plan. Weak evidence: it ranks with hobby-related reasons and never makes a "strong match" headline alone.
import { reasonText } from '../constants/recommendationReasonVocabulary';
export function friendsInterestReason(tag, entry) {
  const count = Number(entry?.friend_count ?? entry?.count ?? 0);
  const clean = typeof tag === 'string' ? tag.trim() : '';
  if (!clean || !Number.isFinite(count) || count < 1) return null;
  const names = (entry?.sample_names ?? entry?.names ?? []).filter(Boolean).slice(0, 2);
  if (names.length === 0) return count === 1 ? reasonText('aFriendInto', { category: clean }) : reasonText('friendsIntoCount', { count, category: clean });
  const others = count - names.length;
  if (count === 1) return reasonText('friendIntoOne', { name: names[0], category: clean });
  if (others <= 0) return reasonText('friendIntoTwo', { name1: names[0], name2: names[1], category: clean });
  return others === 1
    ? reasonText('friendIntoManyOne', { names: names.join(', '), category: clean })
    : reasonText('friendIntoMany', { names: names.join(', '), count: others, category: clean });
}

export const FRIEND_INTEREST_PATTERN = /^.+ (is|are) into .+$/;
