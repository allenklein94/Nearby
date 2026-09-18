// The 6 notification categories (columns on profiles, see migration 20261005_notification_categories).
// Onboarding's "What would you like Nearby to keep you posted about?" and Settings -> Notifications both
// write these same columns: onboarding is the initial configuration, Settings is the full control center.
export const NOTIFICATION_CATEGORIES = [
  { column: 'notify_discovery', icon: '🎯', label: 'Things to do', hint: 'Events and places that match your interests, near you.' },
  { column: 'notify_social', icon: '💬', label: 'Friends & dating', hint: 'Friend requests, matches, messages and waves.' },
  { column: 'notify_planning', icon: '📅', label: 'Plans', hint: 'Gathering approvals and reminders as plans come up.' },
  { column: 'notify_business', icon: '🏪', label: 'Businesses & offers', hint: 'An offer or update from a place you have interacted with.' },
  { column: 'notify_proximity', icon: '👋', label: 'Nearby opportunities', hint: 'When you cross paths with someone nearby.' },
];

// Columns default to true server-side, so only an explicit opt-out needs writing.
export function notificationOptOuts(choices) {
  const out = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    if (choices && choices[c.column] === false) out[c.column] = false;
  }
  return out;
}
