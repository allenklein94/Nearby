// A gathering invitation is only actionable while the gathering is still ahead.
// Past gathering: viewable, never acceptable, and it is "expired" (the person
// missed the window), not "declined". Mirrors respond_to_social_invite
// (migration 20270125), which enforces the same rule server-side.
export function isInviteExpired(invite, now = Date.now()) {
  if (invite?.inviteType !== 'gathering' || !invite?.scheduledAt) return false;
  const t = new Date(invite.scheduledAt).getTime();
  return Number.isFinite(t) && t < now;
}

export function expiredInviteLabel(invite) {
  const d = new Date(invite.scheduledAt);
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return { title: 'Invitation expired', detail: `${date} • Past` };
}
