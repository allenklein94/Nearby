// "Friends who like Coffee" (owner sign-off, 2026-09-21). Accepted friends only (the server function get_friends_interested_in
// enforces it, blocks included); a friend's interest is worded as what it is ("Sam is into Coffee"), never as the viewer's own
// taste and never as a plan. Weak evidence: it ranks with hobby-related reasons and never makes a "strong match" headline alone.
export function friendsInterestReason(tag, entry) {
  const count = Number(entry?.friend_count ?? entry?.count ?? 0);
  const clean = typeof tag === 'string' ? tag.trim() : '';
  if (!clean || !Number.isFinite(count) || count < 1) return null;
  const names = (entry?.sample_names ?? entry?.names ?? []).filter(Boolean).slice(0, 2);
  if (names.length === 0) return count === 1 ? `A friend is into ${clean}` : `${count} friends are into ${clean}`;
  const others = count - names.length;
  if (count === 1) return `${names[0]} is into ${clean}`;
  if (others <= 0) return `${names[0]} and ${names[1]} are into ${clean}`;
  return `${names.join(', ')} and ${others} more friend${others === 1 ? '' : 's'} are into ${clean}`;
}

export const FRIEND_INTEREST_PATTERN = /^.+ (is|are) into .+$/;
