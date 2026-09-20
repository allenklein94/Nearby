// Pure helpers for sharing a night (view-only). The picker only ever lists people the owner is ALREADY connected to
// (accepted friends + matches); the server independently refuses anyone else, so this is convenience, not the guard.

// Friends + matches, de-duplicated by person, minus people it is already shared with, sorted by name.
export function shareCandidates(friends, matches, shares) {
  const already = new Set((shares ?? []).filter((s) => s.userId).map((s) => s.userId));
  const byId = new Map();
  for (const p of [...(friends ?? []), ...(matches ?? [])]) {
    if (p?.id && !already.has(p.id) && !byId.has(p.id)) byId.set(p.id, { id: p.id, display_name: p.display_name || 'Friend' });
  }
  return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// One list row: who + what kind of access, with the guest link's real expiry date.
export function shareRowLabel(share, now = Date.now()) {
  if (share.kind === 'guest') {
    const exp = share.expiresAt ? new Date(share.expiresAt) : null;
    const expired = exp && exp.getTime() <= now;
    const when = exp ? exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
    return {
      title: share.guestName,
      subtitle: expired ? 'Link expired' : `Guest link${when ? ` · works until ${when}` : ''}`,
    };
  }
  return { title: share.displayName || 'Friend', subtitle: 'Can view' };
}
