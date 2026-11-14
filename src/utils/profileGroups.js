// Business Profile tab (owner audit 2026-11-14): the long list of settings is folded into a few groups under their
// existing titles, ONE open at a time (item 31: one inline expansion per surface; opening one closes the rest). Every
// control, its save and its server rule are unchanged; only where it sits on the page changed. Tell Nearby about your
// business stays above the groups, always visible: it is the quick way to fill most of them.
export const PROFILE_GROUPS = ['basics', 'accommodate', 'who', 'grow', 'teach', 'settings'];
export const DEFAULT_PROFILE_GROUP = 'basics';

// Tapping a group's header: opens it (closing whichever was open) or closes it if it was the open one.
export function toggleProfileGroup(current, key) {
  if (!PROFILE_GROUPS.includes(key)) return current ?? null;
  return current === key ? null : key;
}

// Where a link into Profile lands: a known group opens; anything else = the default group.
export function profileGroupFor(key) {
  return PROFILE_GROUPS.includes(key) ? key : DEFAULT_PROFILE_GROUP;
}
