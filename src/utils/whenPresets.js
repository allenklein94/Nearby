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

// Tonight sets the day only (owner, 2026-10-27): the person picks the clock time, on every path into Create.
// Tomorrow too (device test, owner 2026-11-27): "dinner tomorrow" became a NOON gathering because Tomorrow filled 12:00.
// A day word never invents a clock time; Create's existing "Pick a time" asks it (an exact time the person stated still
// arrives as quickStartWhenISO and wins).
export function presetLeavesTime(preset) {
  return preset === 'tonight' || preset === 'tomorrow';
}

// The day a day-only preset names, in local time: Tonight = today, Tomorrow = the next local day.
export function dayForPreset(preset, now = new Date()) {
  const d = new Date(now);
  if (preset === 'tomorrow') d.setDate(d.getDate() + 1);
  return d;
}

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

// The LOCAL calendar day of a date as YYYY-MM-DD. Never toISOString().slice(0, 10): that is the UTC day, so a 7 PM
// Eastern "Tonight" (midnight UTC) became tomorrow's date (found 2026-11-27 in Celebrate Something).
export function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
