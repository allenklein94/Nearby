// The host's command center on GatheringDetail (owner item 143, "hosts need a mini command center"): one compact block that
// answers, for the person hosting, who is coming, who they invited and where each stands, what the business side is doing,
// and what they can do next. This file only shapes data the host is already allowed to read; it decides no state of its own:
//   - attendance comes from gathering_interest (the host reads every row of their own gathering),
//   - invitations from social_invites the HOST sent (attendees' own invitations are theirs, never shown here),
//   - Interested is a COUNT only (item 37: Interested is private; never a name, never per invitee),
//   - the business line from the gathering's own business request and its offers (the requester's own rows).
// Unknown (a failed lookup) is null and is left out, never shown as 0.

// What the stats row shows, in this order. Going is always shown when known; the rest only when there is something.
export function hostStats({ going, requests, waitlisted, interested } = {}) {
  const out = [];
  if (Number.isFinite(going)) out.push({ key: 'going', value: going });
  if (Number.isFinite(requests) && requests > 0) out.push({ key: 'requests', value: requests });
  if (Number.isFinite(waitlisted) && waitlisted > 0) out.push({ key: 'waitlisted', value: waitlisted });
  if (Number.isFinite(interested) && interested > 0) out.push({ key: 'interested', value: interested });
  return out;
}

// The stats line under the host's header. Join requests are NOT on it: they have their own "N requests to join · Review"
// row (owner item 144) counted from the very requests it opens, so the number is never shown twice or disagrees.
export function hostSummaryStats(stats) {
  return hostStats(stats).filter((s) => s.key !== 'requests');
}

// A host's decision applied to the loaded rows right away: approved/waitlisted changes the status, null (declined or
// removed) drops the row. The server reload that follows replaces the whole list.
export function applyDecision(rows, id, status) {
  if (!Array.isArray(rows)) return rows;
  return status == null ? rows.filter((r) => r.id !== id) : rows.map((r) => (r.id === id ? { ...r, status } : r));
}

// The Review row: present only while there is at least one pending request to decide. Visibility is deliberately not read
// (owner, 2026-10-02): a pending request exists only where the host must decide (public + Require approval, Friends,
// Community, Invite-only), so the row shows for any of them.
export function pendingReview(rows) {
  const pending = (rows ?? []).filter((r) => r.status === 'pending');
  return { count: pending.length, rows: pending, show: pending.length > 0 };
}

// One status per invited friend. What they actually did with the gathering beats what they did with the invitation:
// someone who joined is Going even if they never tapped Accept. Accepting an invitation does NOT join the gathering
// (respond_to_social_invite only records the answer), so "Accepted" means "said yes, hasn't joined yet".
export const INVITATION_STATUS_ORDER = ['going', 'requested', 'waitlisted', 'accepted', 'invited', 'declined', 'expired'];

export function invitationStatus(invite, attendanceStatus, { past = false } = {}) {
  if (attendanceStatus === 'approved') return 'going';
  if (attendanceStatus === 'pending') return 'requested';
  if (attendanceStatus === 'waitlisted') return 'waitlisted';
  const s = invite?.status;
  if (s === 'accepted') return 'accepted';
  if (s === 'declined') return 'declined';
  if (s === 'expired') return 'expired';
  if (s === 'pending') return past ? 'expired' : 'invited';
  return null;
}

// invites: [{ invitee_id, status, created_at, name }] the host sent for this gathering (several per person are possible:
// a declined one, then a new one). attendance: Map(user_id -> gathering_interest.status). One row per person, from their
// newest invitation, ordered by status then name.
export function invitationRows(invites, attendance, { past = false } = {}) {
  const newest = new Map();
  for (const inv of invites ?? []) {
    if (!inv?.invitee_id) continue;
    const prev = newest.get(inv.invitee_id);
    if (!prev || String(inv.created_at ?? '') > String(prev.created_at ?? '')) newest.set(inv.invitee_id, inv);
  }
  const rows = [];
  for (const inv of newest.values()) {
    const status = invitationStatus(inv, attendance?.get?.(inv.invitee_id), { past });
    if (!status) continue;
    rows.push({ userId: inv.invitee_id, name: inv.name ?? null, status });
  }
  const rank = (s) => INVITATION_STATUS_ORDER.indexOf(s);
  return rows.sort((a, b) => rank(a.status) - rank(b.status) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

// The business side in one line. Only used while nothing is booked: a booked offer has its own card with the details.
//   request: the gathering's business request (open/fulfilled) or null
//   offers: { pendingCount, offeredCount, offeredNames } from the request's live offers
//   partnership: the host's "this specific business" co-host request, if any { status, partnerName }
export function hostBusinessLine({ request, offers, partnership } = {}) {
  if (request) {
    const offered = offers?.offeredCount ?? 0;
    const waiting = offers?.pendingCount ?? 0;
    if (offered === 1) return { state: 'offer_received', name: offers?.offeredNames?.[0] ?? null };
    if (offered > 1) return { state: 'offers_received', count: offered };
    if (waiting > 0) return { state: 'waiting', count: waiting };
    return { state: 'asked' };
  }
  if (partnership?.status === 'approved') return { state: 'partner_confirmed', name: partnership.partnerName ?? null };
  if (partnership?.status === 'pending') return { state: 'partner_pending', name: partnership.partnerName ?? null };
  return null;
}

// The host's actions, each only where it is allowed. Edit and Cancel follow the gathering's lifecycle (can('edit'));
// a finished gathering keeps Message and the attendee list, nothing that would change it.
export function hostActions({ canEdit, canInvite, hasChat = true } = {}) {
  const out = [];
  if (canInvite) out.push('invite');
  if (canEdit) out.push('edit');
  if (hasChat) out.push('message');
  out.push('manage');
  if (canEdit) out.push('cancel');
  return out;
}

// The Message action's count (supplemental; the label stays "Message"). The figure is getGatheringMessageCount: a
// count-only read through gathering_messages RLS, so it is exactly what the host can open in the chat (blocked
// senders excluded either way); no message content or sender is ever read for it. 0 and unknown show no badge.
export const MESSAGE_BADGE_MAX = 99;
export function messageBadge(count) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > MESSAGE_BADGE_MAX ? `${MESSAGE_BADGE_MAX}+` : String(count);
}
