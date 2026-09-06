// Sep 6 2026 (CLAUDE.md, external UX critique item 9): Quick Filters
// customization used to only let a user reorder/show-hide the same fixed
// 3 booleans (Verified/Match %/Online) -- not real customization, just
// filter ordering. This catalog is the real, honest set of filter
// dimensions each mode can offer: only ones already backed by real, live
// filtering logic (no invented signals, see CLAUDE.md's "no fabricated
// signals" rule). 'kind' drives both QuickFilterCustomizeScreen's value
// editor and how the owning screen applies the filter:
//   'boolean'   -- plain on/off, no configurable value
//   'threshold' -- on/off + a single configurable numeric value, chosen
//                  from a fixed set of real options, set in Customize
// Age Range and the Advanced (Premium) fields intentionally aren't here --
// they already have their own first-class, always-live control elsewhere
// in FiltersModal, and duplicating them as a second, separately-configured
// preset would just create two disagreeing sources of truth for the same
// value.
export const DATING_QUICK_FILTER_CATALOG = [
  { key: 'verified', icon: '✓', label: 'Verified Only', kind: 'boolean', a11y: 'Filter to only photo-verified profiles' },
  { key: 'highCompat', icon: '🎯', label: 'Match %', kind: 'threshold', unit: '%', valueOptions: [50, 60, 70, 80, 90], defaultValue: 70 },
  { key: 'online', icon: '🟢', label: 'Online Now', kind: 'boolean', a11y: 'Filter to only people online now' },
  { key: 'sharedInterests', icon: '✨', label: 'Shared Interests', kind: 'boolean', a11y: 'Filter to people who share at least one of your interests' },
];

export const DATING_DEFAULT_ORDER = ['verified', 'highCompat', 'online'];
export const DATING_DEFAULT_VISIBLE = ['verified', 'highCompat', 'online'];
export const DATING_DEFAULT_CONFIG = { highCompat: { value: 70 } };

// Friends' own real filter dimensions -- all already exist as live,
// working controls in FriendDiscoveryScreen's filter accordion (interest
// tags, a real distance bucket from get_friend_discovery_candidates,
// verified/online booleans). Unlike Dating's Match % threshold, these are
// naturally "pick right now" filters people already set live in the
// accordion -- there's no separate value to pre-configure here, so
// Customize just controls which sections show and in what order. That's
// the real, non-duplicative version of "same mechanics, configured
// differently" for this screen: 'kind' still says how each is actually
// set (live in the accordion, not a preset), it's just never 'threshold'.
export const FRIEND_QUICK_FILTER_CATALOG = [
  { key: 'interests', icon: '🎯', label: 'Interests', kind: 'liveMultiselect' },
  { key: 'distance', icon: '📍', label: 'Distance', kind: 'liveSelect' },
  { key: 'verified', icon: '✓', label: 'Verified Only', kind: 'boolean' },
  { key: 'online', icon: '🟢', label: 'Online Now', kind: 'boolean' },
];

export const FRIEND_DEFAULT_ORDER = ['interests', 'distance', 'verified', 'online'];
export const FRIEND_DEFAULT_VISIBLE = ['interests', 'distance', 'verified', 'online'];
export const FRIEND_DEFAULT_CONFIG = {};
