// Duration vs the person's available time (owner item 68, 2026-09-25): "I only have an hour." The ask states a TIME BUDGET in its
// own words (deterministic phrase rules, never AI); a result's length is REAL data first -- a gathering's host-declared
// `duration_minutes` (item 39) -- else the typical length of its canonical category tag (the table below: near-certain norms only,
// test-verified tags; a tag not listed has no length). A typical length is never shown as the host's claim: it is worded
// "Usually about 45 min". Ranking only: fits the time lifts, clearly too long sinks, unknown is untouched, nothing is removed.
// Typed requests only; stores nothing.
import { durationLabel } from '../utils/gatheringPractical';

export const TAG_TYPICAL_MINUTES = {
  Coffee: 45, Bakeries: 30, 'Dessert & Ice Cream': 30, 'Food Trucks': 30, 'Fast Casual': 45, Breakfast: 60, Brunch: 90,
  Restaurants: 90, 'Fine Dining': 120, 'Happy Hour': 90, 'Bars & Lounges': 90, Breweries: 90, Wineries: 120,
  Movies: 120, Theater: 150, Concerts: 180, 'Live Music': 120, Comedy: 90, Karaoke: 120, Trivia: 120, 'Board Games': 120,
  Bowling: 90, 'Mini Golf': 90, Arcade: 60, 'Escape Rooms': 60, Golf: 240,
  Yoga: 60, Pilates: 60, Fitness: 60, Running: 45, Walking: 45, Pickleball: 90, Tennis: 90, Climbing: 120, Swimming: 60,
  Hiking: 150, Kayaking: 120, Parks: 60,
  Museums: 120, 'Art Galleries': 60, Zoos: 180, Aquariums: 120, 'Amusement Park': 360,
  'Cooking Class': 150, Workshops: 120, Massage: 60, 'Spa Day': 180,
};

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, 'a couple': 2, 'a couple of': 2, few: 3, 'a few': 3 };
const num = (s) => (s == null ? null : /^\d+(\.\d+)?$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase().trim()] ?? null);

// Minutes the person says they have, or null. Only a stated amount of time counts ("an hour", "30 minutes", "a couple of hours",
// "an hour and a half", "half an hour"); "quick" or "tonight" is not a budget (commitment/spontaneity handle those).
export function timeBudgetFromText(text) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.toLowerCase();
  // Must be framed as available time, not an activity's length ("a 2 hour hike" is not a budget).
  const framed = /\b(i|we)\s+(only\s+|just\s+)?(have|got)\b|\b(i|we)['’]ve\s+(only\s+)?got\b|\bonly\s+(have\s+)?(got\s+)?\b|\bfor\s+(about\s+|around\s+|just\s+)?(an?|one|two|three|\d|half|a\s+couple|a\s+few|an\s+hour)|\b(have|got)\s+(about\s+|around\s+)?(an?|\d|half|a\s+couple|a\s+few)\b|\bin\s+(under|less\s+than)\b|\bunder\s+(an?|\d)|\bless\s+than\s+(an?|\d)|\bfree\s+for\b/;
  if (!framed.test(t)) return null;
  if (/\bhalf\s+an\s+hour\b/.test(t)) return 30;
  let m = t.match(/\b(an?|one|two|three|\d+(?:\.\d+)?)\s+hours?\s+and\s+a\s+half\b/);
  if (m) return num(m[1]) * 60 + 30;
  m = t.match(/\b(an?|one|two|three|four|five|six|a\s+couple(?:\s+of)?|couple(?:\s+of)?|a\s+few|few|\d+(?:\.\d+)?)\s+(?:hours?|hrs?)\b/);
  if (m) { const n = num(m[1].replace(/\s+of$/, '')); if (n) return Math.round(n * 60); }
  m = t.match(/\b(\d+)\s*(?:minutes?|mins?)\b/);
  if (m) return Number(m[1]);
  return null;
}

// A candidate's length: { minutes, declared } or null. `c` may carry { durationMinutes, category }.
// The candidate's own `category` only (business supply unchanged by decision: no posting duration yet).
export function lengthOf(c) {
  if (Number.isFinite(c?.durationMinutes) && c.durationMinutes >= 15) return { minutes: c.durationMinutes, declared: true };
  const typical = c?.category ? TAG_TYPICAL_MINUTES[c.category] : null;
  return typical ? { minutes: typical, declared: false } : null;
}

export function lengthPhrase(len) {
  if (!len) return null;
  const d = durationLabel(len.minutes);
  return d ? (len.declared ? `About ${d}` : `Usually about ${d}`) : null;
}

export const TIME_FIT_POINTS = 2;
export const TIME_OVER_POINTS = -2;
// A little over is not "too long" (people round); clearly too long = more than a quarter over the budget.
export const TIME_SLACK = 1.25;

export function timeFit(candidate, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return { delta: 0, reason: null };
  const len = lengthOf(candidate);
  if (!len) return { delta: 0, reason: null };
  if (len.minutes <= budget) return { delta: TIME_FIT_POINTS, reason: `⏱️ ${lengthPhrase(len)}` };
  if (len.minutes > budget * TIME_SLACK) return { delta: TIME_OVER_POINTS, reason: null };
  return { delta: 0, reason: null };
}

export function applyTimeBudgetToCandidates(candidates, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = timeFit(c, budget);
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle } : c;
  });
}

// Spoken amount of time: 60 = "an hour", 30 = "half an hour", 90 = "an hour and a half", 120 = "2 hours", 45 = "45 minutes".
export function timePhrase(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes === 60) return 'an hour';
  if (minutes === 30) return 'half an hour';
  if (minutes === 90) return 'an hour and a half';
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return durationLabel(minutes);
}

// The one caption line ("Picking things that fit in about 2 hours"), joined onto the resolver's existing note line.
export function timeBudgetCaption(budget) {
  const p = timePhrase(budget);
  return p ? `Picking things that fit in about ${p}` : null;
}
