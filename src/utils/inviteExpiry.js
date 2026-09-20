// A gathering invitation is only actionable while the gathering is still ahead.
// Past gathering: viewable, never acceptable, and it is "expired" (the person
// missed the window), not "declined". Mirrors respond_to_social_invite
// (migration 20270125), which enforces the same rule server-side.
// Derived-state logic lives in utils/objectState.js (one home for Past/Expired); re-exported so imports keep working.
export { isSocialInviteExpired as isInviteExpired, isGatheringRequestExpired, isOccasionInviteExpired } from './objectState';

export function expiredInviteLabel(invite) {
  const d = new Date(invite.scheduledAt);
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return { title: 'Invitation expired', detail: `${date} • Past` };
}

export function expiredDateLabel(dateLike) {
  const raw = typeof dateLike === 'string' && dateLike.length === 10 ? `${dateLike}T00:00:00` : dateLike;
  const date = new Date(raw).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `${date} • Past`;
}
