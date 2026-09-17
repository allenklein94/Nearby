// Item 109 (CLAUDE.md, "Security/privacy should be designed in from day one
// ... make the visibility model explicit"): the single source of truth for
// a gathering's real visibility tiers, extracted out of
// CreateGatheringScreen's own local copy so GatheringDetailScreen (and any
// future consumer) can render the exact same icon/label instead of a second
// copy that could drift. Ordered narrowest-to-widest, matching the picker's
// own display order.
export const VISIBILITY_OPTIONS = [
  { key: 'invite_only', icon: '🔒', label: 'Invite Only', hint: "Only people you personally invite — you'll approve each person" },
  { key: 'friends', icon: '👥', label: 'Friends', hint: 'Only your friends can find this' },
  { key: 'community', icon: '🏘', label: 'Community', hint: 'Only members of one of your communities' },
  { key: 'everyone', icon: '🌍', label: 'Everyone', hint: 'Anyone nearby can discover this' },
];

export function visibilityMeta(key) {
  return VISIBILITY_OPTIONS.find((v) => v.key === key) ?? null;
}
