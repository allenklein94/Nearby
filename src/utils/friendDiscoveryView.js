// Owner idea 156 (2026-10-17): swiping is a choice, never a requirement for meeting friends. Friends discovery opens as a
// list (like Dating's `discovery_view_style`); the swipe deck is an optional mode stored in its OWN profile column
// (`friend_discovery_view_style`, migration 20270328), so a Friends choice never changes Dating's view and vice versa.
// Both modes decide through the same two labelled actions below and the same recordFriendDiscoverySwipe call.

export const FRIEND_VIEW_STYLES = ['list', 'cards'];

// Anything but an explicit 'cards' (null, unknown, a failed read) is the list.
export function friendViewStyle(stored) {
  return stored === 'cards' ? 'cards' : 'list';
}

export function otherFriendViewStyle(style) {
  return friendViewStyle(style) === 'cards' ? 'list' : 'cards';
}

// The ONE table of Friends decisions. `direction` is what record_friend_discovery_swipe stores; the label is always
// visible text, never a bare symbol (guard: friendDiscoveryView.test.js).
export const FRIEND_DECISIONS = {
  pass: { direction: 'pass', labelKey: 'ui.friends.passAction', a11yKey: 'ui.friends.passOnA11y' },
  connect: { direction: 'like', labelKey: 'ui.friends.connect', a11yKey: 'ui.friends.connectWithA11y' },
};

// Candidates still waiting for a decision, in their original order. Both modes read this, so a person decided in one
// mode never reappears in the other, and a failed write (id taken back out of the set) puts the person back.
export function undecidedCandidates(candidates, decidedIds) {
  if (!decidedIds || decidedIds.size === 0) return candidates;
  return candidates.filter((c) => !decidedIds.has(c.id));
}
