// 10/10 roadmap Part 7 (see CLAUDE.md's "10/10 roadmap" plan): Home
// progressive personalization. Pure functions only, no I/O -- the actual
// fetch of a caller's own intent_submissions history lives in
// services/intentOutcomes.js's getMyIntentPatterns(), which calls
// findRecurringIntentPattern() below. Kept separate and pure so it's
// directly unit-testable, matching Part 8's "pure functions get real Jest
// coverage" convention.
import { getTimePeriod } from './timeContext';

// A pattern only counts once it's shown up this many times -- a real,
// stated threshold ("3+ times"), not a fabricated one.
const MIN_OCCURRENCES = 3;

// Groups the caller's own past intent_submissions rows (category set) by
// real (day-of-week, time-period, category), and returns the one
// recurring pattern -- 3+ occurrences -- that matches *right now*, or
// null if none does. Deliberately narrow: this isn't "your most common
// category ever," it's "does a real, repeated Friday-night-Coffee-shaped
// pattern exist, and is it actually Friday night right now" -- matches
// the roadmap's own framing ("Friday nights -> Coffee" appearing 3+
// times, surfaced only as one smarter placeholder example).
export function findRecurringIntentPattern(rows, now = new Date()) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const counts = new Map();
  for (const row of rows) {
    if (!row?.category || !row?.created_at) continue;
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getDay()}|${getTimePeriod(d)}|${row.category}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const currentDay = now.getDay();
  const currentPeriod = getTimePeriod(now);
  let best = null;
  for (const [key, count] of counts.entries()) {
    if (count < MIN_OCCURRENCES) continue;
    const [dayStr, period, category] = key.split('|');
    if (Number(dayStr) !== currentDay || period !== currentPeriod) continue;
    if (!best || count > best.count) best = { category, dayOfWeek: currentDay, period, count };
  }
  return best;
}

// Item 46 (CLAUDE.md, "personalization should determine what appears
// first"): a broader sibling of findRecurringIntentPattern() above --
// that one is deliberately narrow (a specific day-of-week + time-window
// + category combo, 3+ times, matching right now). This one just asks
// "what category has this person genuinely searched for over and over,
// regardless of when" -- the real signal behind "someone who constantly
// looks for fitness should see Fitness near you." Same MIN_OCCURRENCES
// threshold (a real, stated floor, not a fabricated one) and the same
// "return null, never a guess, when nothing qualifies" discipline --
// that null is exactly what lets the caller fall back honestly to
// Discover's existing Happening Now/Today/This Weekend/Categories
// hierarchy per item 47 ("don't over-personalize too early").
export function findTopSearchedCategory(rows, minOccurrences = MIN_OCCURRENCES) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const counts = new Map();
  for (const row of rows) {
    if (!row?.category) continue;
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  let best = null;
  for (const [category, count] of counts.entries()) {
    if (count < minOccurrences) continue;
    if (!best || count > best.count) best = { category, count };
  }
  return best;
}

const PERIOD_PLACEHOLDER_SUFFIX = {
  morning: 'this morning?',
  afternoon: 'this afternoon?',
  evening: 'tonight?',
  weekend: 'this weekend?',
};

// "Coffee" + 'evening' -> "Coffee tonight?" -- one smarter placeholder
// example, never a full sentence claiming to know anything, never
// auto-submitted.
export function formatSmartPlaceholder(pattern) {
  if (!pattern?.category) return null;
  const suffix = PERIOD_PLACEHOLDER_SUFFIX[pattern.period] ?? 'soon?';
  return `${pattern.category} ${suffix}`;
}
