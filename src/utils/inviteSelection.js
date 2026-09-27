// Pure selection helpers for FriendInviteSelector (item 109): which friends are picked for a gathering not yet published.
// Selected ids as a list (selectedIds is { [friendId]: boolean }).
export const selectedFriendIdList = (selectedIds) => Object.keys(selectedIds ?? {}).filter((id) => selectedIds[id]);
// Only selections that are in the loaded accepted-friend list survive.
export function keepEligible(selectedIds, friends) {
  const eligible = new Set((friends ?? []).map((f) => f.id));
  return Object.fromEntries(selectedFriendIdList(selectedIds).filter((id) => eligible.has(id)).map((id) => [id, true]));
}
// Initial selection from explicitly suggested friends (never from typed text).
export const selectionFromSuggested = (ids) => Object.fromEntries((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id).map((id) => [id, true]));

