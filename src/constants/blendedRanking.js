// Progressive personalization: "explicit preferences > behavior" for a new account, "behavior + explicit + context" later.
// Built on signalSourceMaturity.js (one maturity number; explicit is never dampened, behavior is). Ranking only ever
// REORDERS -- nothing is hidden -- and it is stable, so with no signals the original order is kept.
import { SIGNAL_SOURCES, weightSignal } from './signalSourceMaturity';
import { canonicalizeInterests } from './interestGraph';

export const EXPLICIT_POINTS = 5;      // matches SCORE_INTEREST_MATCH: a declared interest is the strongest single signal
export const BEHAVIOR_MAX_POINTS = 4;  // strictly below EXPLICIT_POINTS: behavior alone can lift, never outrank a declared interest
export const BEHAVIOR_WEIGHT_FOR_MAX = 12; // matches the per-category cap in get_my_behavior_categories

// rows: [{ category, weight }] from get_my_behavior_categories -> { [category]: weight }
export function behaviorWeightMap(rows) {
  const map = {};
  for (const r of rows ?? []) if (r?.category) map[r.category] = Number(r.weight) || 0;
  return map;
}

export function blendedCategoryScore(category, { declared = [], behavior = {}, maturity = null } = {}) {
  if (!category) return 0;
  const explicit = canonicalizeInterests(declared).includes(category) ? EXPLICIT_POINTS : 0;
  const raw = Math.min(1, (behavior[category] ?? 0) / BEHAVIOR_WEIGHT_FOR_MAX) * BEHAVIOR_MAX_POINTS;
  return explicit + weightSignal(raw, SIGNAL_SOURCES.BEHAVIORAL, maturity);
}

// Stable descending sort by blended score; equal scores keep their incoming order.
export function rankByBlend(items, ctx, tagOf = (x) => x.interest_tag) {
  const scored = items.map((it, i) => ({ it, i, s: blendedCategoryScore(tagOf(it), ctx) }));
  if (scored.every((x) => x.s === 0)) return items;
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it);
}

// Categories for "For You": declared ones always qualify; behavior-only ones qualify once behavior is trusted
// (maturity > 0). Ordered by blended score.
export function forYouBlend(declared, behavior, maturity, limit = 50) {
  const cats = new Set([...canonicalizeInterests(declared), ...Object.keys(behavior ?? {})]);
  return [...cats]
    .map((c) => ({ c, s: blendedCategoryScore(c, { declared, behavior, maturity }) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

// Just the behavioral part (0..BEHAVIOR_MAX_POINTS, dampened by maturity) -- for surfaces whose own score already counts declared
// interests (Discover's fit.score) and only need the behavior nudge added on top.
export function behaviorNudge(category, { behavior = {}, maturity = null } = {}) {
  if (!category) return 0;
  const raw = Math.min(1, (behavior[category] ?? 0) / BEHAVIOR_WEIGHT_FOR_MAX) * BEHAVIOR_MAX_POINTS;
  return weightSignal(raw, SIGNAL_SOURCES.BEHAVIORAL, maturity);
}
