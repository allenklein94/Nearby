// Shared "When?" preset chips + their deterministic date math -- factored
// out of CreateGatheringScreen.js (its own established Create 2.0 "When"
// step) so Phase 4's MakeAPlanScreen.js (see CLAUDE.md's "build
// everything" plan) can reuse the exact same real, non-fabricated date
// logic rather than a second copy that could quietly drift. Matches this
// codebase's own long-standing rule: AI/recommendations never infer or
// assign a specific date or time -- the user always picks one through
// this same deterministic UI.
export const WHEN_PRESETS = [
  { key: 'now', icon: '⚡', label: 'Now' },
  { key: 'tonight', icon: '🌙', label: 'Tonight' },
  { key: 'tomorrow', icon: '☀️', label: 'Tomorrow' },
  { key: 'custom', icon: '🗓️', label: 'Pick a Date' },
];

export function dateForPreset(preset) {
  const now = new Date();
  if (preset === 'now') return new Date(now.getTime() + 15 * 60 * 1000);
  if (preset === 'tonight') {
    const d = new Date(now);
    d.setHours(19, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  if (preset === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}
