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

// A gathering join request is still "pending" server-side once the gathering
// has passed (the host can no longer approve it, migration 20270126); it is
// DISPLAYED as expired, never as declined and never as an open request.
export function isGatheringRequestExpired(gathering, now = Date.now()) {
  if (!gathering?.scheduled_at) return false;
  const t = new Date(gathering.scheduled_at).getTime();
  return Number.isFinite(t) && t < now;
}

// Occasion group-plan invite: scheduled_date is a plain date (or null = never
// expires). Mirrors _occasion_plan_is_past (20270126) using the local day, so
// the event day itself is still actionable.
export function isOccasionInviteExpired(scheduledDate, now = new Date()) {
  if (!scheduledDate) return false;
  const d = new Date(`${scheduledDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() < today.getTime();
}

export function expiredDateLabel(dateLike) {
  const raw = typeof dateLike === 'string' && dateLike.length === 10 ? `${dateLike}T00:00:00` : dateLike;
  const date = new Date(raw).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `${date} • Past`;
}
