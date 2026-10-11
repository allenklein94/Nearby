// Owner item 25 (2026-10-11): the path of the light in the signature moment (a business responds). A gentle arc from a to b,
// sampled at a few points for Animated.interpolate: it bows upward (toward the top of the screen) by at most arcPx, and never
// by more than arcShare of the distance, so a short hop stays almost straight and a long one never swings wide. Pure.
export const ARC_SAMPLES = 6;

export function arcPoints(a, b, { arcPx = 72, arcShare = 0.25, samples = ARC_SAMPLES } = {}) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const bow = Math.min(arcPx, dist * arcShare);
  const t = [];
  const x = [];
  const y = [];
  for (let i = 0; i <= samples; i += 1) {
    const p = i / samples;
    t.push(p);
    x.push(a.x + (b.x - a.x) * p);
    // 4p(1-p) peaks at 1 halfway and is 0 at both ends: the light leaves and lands exactly on its points.
    y.push(a.y + (b.y - a.y) * p - bow * 4 * p * (1 - p));
  }
  return { t, x, y, bow };
}
