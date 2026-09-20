// "Who can join?": Anyone (one tap, auto-approved) vs Require approval (host reviews each request). Mirrors
// join_gathering(): a request needs review when the host turned approval on, or the gathering is non-public
// (invite-only). Capacity is separate -- a full gathering waitlists either way.
export function needsApproval(gathering) {
  return !!gathering && (gathering.is_public === false || gathering.requires_approval === true);
}

export function joinLabel(gathering, { isFull = false } = {}) {
  if (isFull) return 'Join Waitlist';
  return needsApproval(gathering) ? 'Request to Join' : 'Join Gathering';
}
