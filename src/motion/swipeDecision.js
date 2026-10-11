// Owner item 20: the pure swipe-to-dismiss rule (no React Native), shared by useSwipeToDismiss and its tests.

export const SWIPE_CLAIM_PX = 8;
export const SWIPE_DISMISS_PX = 40;
export const SWIPE_DISMISS_VELOCITY = 0.5;

const AXES = { up: ['dy', -1], down: ['dy', 1], left: ['dx', -1], right: ['dx', 1] };

// How far the move went along the allowed directions (0 when it went another way).
export function swipeProgress({ dx = 0, dy = 0 }, directions) {
  const d = { dx, dy };
  return Math.max(0, ...directions.map((dir) => (AXES[dir] ? d[AXES[dir][0]] * AXES[dir][1] : 0)));
}

export function claimsSwipe(move, directions) {
  return swipeProgress(move, directions) > SWIPE_CLAIM_PX;
}

export function isDismissSwipe({ dx = 0, dy = 0, vx = 0, vy = 0 }, directions) {
  if (swipeProgress({ dx, dy }, directions) >= SWIPE_DISMISS_PX) return true;
  return swipeProgress({ dx: vx, dy: vy }, directions) >= SWIPE_DISMISS_VELOCITY;
}
