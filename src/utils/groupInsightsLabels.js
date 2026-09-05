import { categoryStyleFor } from '../constants/gatheringCategoryStyles';

// Group Insights plan (2026-09-18) -- pure display-formatting helpers for
// get_gathering_group_insights()'s payload. The RPC already did every real
// aggregation/thresholding decision server-side (see the migration for
// why); these functions only turn its pre-computed fields into copy. None
// of this ever re-derives a count/percentage the RPC didn't send.

// Precise-tier bucket line, e.g. "25-34 · 50%" / "Women · 50%".
export function formatPreciseBucketLine(bucket) {
  if (!bucket || bucket.label == null || bucket.pct == null) return null;
  return `${bucket.label} · ${bucket.pct}%`;
}

// Shared-interests line. Coarse tier gets plain names ("Coffee · Food ·
// Music"); precise tier gets per-tag counts with the same emoji already
// used for that interest's category badge elsewhere in the app ("☕ Coffee
// · 10"), so this never invents a second icon set.
export function formatInterestLine({ tier, interestNames, interestCounts } = {}) {
  if (tier === 'precise' && interestCounts?.length > 0) {
    return interestCounts
      .map(({ tag, count }) => `${categoryStyleFor(tag).icon} ${tag} · ${count}`)
      .join('  ');
  }
  if (interestNames?.length > 0) {
    return interestNames.join(' · ');
  }
  return null;
}
