// Idea "360" narrow fix (owner, 2026-10-23): the gathering Invite sheet shows each friend in their real state.
// The state comes from ONE server rule (private._gathering_invitee_state via get_gathering_invite_states); this file only
// turns it into rows. The server re-checks at send time (invite_friend_to_gathering) and refuses with a hint
// 'invite_state:<state>', which inviteRefusalState reads so a stale row updates instead of claiming success.
//   invite  = active Invite button (also when the state is unknown: the server stays the final authority)
//   sent    = invited from this sheet just now ("✓ Sent")
//   going   = host or approved attendee: "Going", no button
//   invited = the person's own invite is already pending/accepted: "Invited", no button
//   ineligible = left out of the list (women-only, host block, no longer a friend)

export const INVITE_ROW_LABEL_KEYS = {
  invite: 'ui.inviteModal.invite',
  sent: 'ui.inviteModal.sent',
  going: 'ui.hostCenter.invite.going',
  invited: 'ui.hostCenter.invite.invited',
};

const KNOWN = new Set(['invite', 'sent', 'going', 'invited', 'ineligible']);

// friends: getMyFriends() rows; states: { [friendId]: state } (server + this sheet's own updates), or null when unknown.
export function inviteSheetRows(friends, states) {
  return (friends ?? [])
    .map((friend) => {
      const s = states?.[friend.id];
      return { friend, state: KNOWN.has(s) ? s : 'invite' };
    })
    .filter((row) => row.state !== 'ineligible');
}

// The server's get_gathering_invite_states rows -> { [friendId]: state }.
export function inviteStateMap(rows) {
  const map = {};
  for (const r of rows ?? []) if (r?.friend_id && KNOWN.has(r.state)) map[r.friend_id] = r.state;
  return map;
}

// A refused invite_friend_to_gathering -> the row's real state, or null for an ordinary failure (network, etc.).
export function inviteRefusalState(error) {
  const m = /^invite_state:(going|invited|ineligible)$/.exec(String(error?.hint ?? ''));
  return m ? m[1] : null;
}

export function inviteRowCanInvite(state) {
  return state === 'invite';
}
