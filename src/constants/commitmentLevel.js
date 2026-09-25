// Commitment level (owner item 45, 2026-09-21): "I don't really want to commit to anything tonight" should surface Coffee, Happy
// Hour, Live Music, a casual walk -- not a 3-hour cooking class. Deterministic (never AI), ranking only (lift the light, sink the
// heavy, never a filter), stores nothing. A result's commitment comes from REAL data first: a gathering's host-declared
// `duration_minutes` (>= 8 h all-day, >= 3 h multi-hour) and `requires_approval` (a planned event); otherwise from its canonical
// category tag (table below, near-certain tags only). Anything unknown has no commitment and is untouched.
import { ACTIVITY_FORMATS } from './activityFormat';

export const COMMITMENT_LEVELS = ['drop_in', 'easy', 'reservation', 'planned_event', 'multi_hour', 'all_day'];
const HEAVY = ['reservation', 'planned_event', 'multi_hour', 'all_day'];

export const TAG_COMMITMENT = {
  Coffee: 'drop_in', 'Happy Hour': 'drop_in', 'Live Music': 'drop_in', Walking: 'drop_in', Bakeries: 'drop_in', 'Bars & Lounges': 'drop_in',
  Breweries: 'drop_in', 'Food Trucks': 'drop_in', 'Dessert & Ice Cream': 'drop_in', 'Fast Casual': 'drop_in', Arcade: 'drop_in', Parks: 'drop_in',
  Brunch: 'easy', Restaurants: 'easy', Museums: 'easy', Bowling: 'easy', 'Mini Golf': 'easy', Trivia: 'easy', Karaoke: 'easy', Movies: 'easy', Comedy: 'easy',
  'Fine Dining': 'reservation', 'Escape Rooms': 'reservation',
  Theater: 'planned_event', Concerts: 'planned_event', Festivals: 'planned_event',
  'Cooking Class': 'multi_hour', Workshops: 'multi_hour', Classes: 'multi_hour', 'Dance Classes': 'multi_hour', Golf: 'multi_hour', Wineries: 'multi_hour', Boating: 'multi_hour', Hiking: 'multi_hour',
  Camping: 'all_day', 'Day Trip': 'all_day', Excursions: 'all_day',
};

// What a candidate asks of the person. `c` may carry { category, durationMinutes, format, requiresApproval }.
export function commitmentOf(c) {
  const m = c?.durationMinutes;
  if (Number.isFinite(m)) {
    if (m >= 480) return 'all_day';
    if (m >= 180) return 'multi_hour';
  }
  // Item 66: a host-declared format (open play = drop in, tournament = a planned event) is real data, ahead of the guesses below.
  const declared = c?.format ? ACTIVITY_FORMATS.find((f) => f.key === c.format)?.commitment : null;
  if (declared) return declared;
  if (c?.requiresApproval === true) return 'planned_event';
  return (c?.category && TAG_COMMITMENT[c.category]) || null;
}

const LIGHT_ASK = /\b(don'?t|do not|not)\s+(really\s+)?(want|need|feel like)\s+(to\s+)?(commit|committing|plan)\b|\bno\s+commitment\b|\blow[- ]commitment\b|\bnothing\s+(too\s+)?(long|heavy|serious|committing|planned)\b|\bdrop[- ]in\b|\bjust\s+(pop|drop|stop)\s+(in|by)\b|\bnothing\s+major\b/i;
const DEEP_ASK = /\b(all|whole|full)[- ]day\b|\bmake\s+a\s+day\s+of\s+it\b|\bspend\s+(the|a)\s+(whole\s+)?(day|afternoon)\b/i;

// 'light' | 'deep' | null from the person's own words.
export function commitmentAsk(text) {
  if (typeof text !== 'string' || !text) return null;
  if (LIGHT_ASK.test(text)) return 'light';
  if (DEEP_ASK.test(text)) return 'deep';
  return null;
}

export const COMMITMENT_FIT_POINTS = 2;
export const COMMITMENT_MISMATCH_POINTS = -2;

export function commitmentFit(candidate, ask) {
  const level = commitmentOf(candidate);
  if (!ask || !level) return { delta: 0, reason: null };
  if (ask === 'light') {
    if (level === 'drop_in') return { delta: COMMITMENT_FIT_POINTS, reason: 'Easy to drop into' };
    if (level === 'easy') return { delta: 1, reason: 'Low commitment' };
    return { delta: COMMITMENT_MISMATCH_POINTS, reason: null };
  }
  return ['multi_hour', 'all_day'].includes(level) ? { delta: COMMITMENT_FIT_POINTS, reason: 'Worth setting time aside' } : { delta: 0, reason: null };
}

export function applyCommitmentToCandidates(candidates, ask) {
  if (!ask) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = commitmentFit(c, ask);
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle } : c;
  });
}

export const isHeavyCommitment = (level) => HEAVY.includes(level);
