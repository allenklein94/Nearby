// Shared geometry for the approved Nearby "N Connection" mark — two rounded
// uprights (each topped by a floating circle standing for a person) joined
// by a diagonal band, on a 0–100 unit design grid so it renders crisply at
// any size.
//
// These numbers are not hand-drawn guesses — they're measured directly off
// the real mark artwork in assets/branding/nearby-brand-final.png (pixel
// bounding boxes for each head circle, each upright's stable capsule width/
// x-range, and a linear fit of the diagonal band's own centerline), then
// mapped onto this 0–100 grid. scripts/generate-brand-assets.py (the app
// icon / notification icon / splash mark / adaptive icon generator) sources
// its shapes straight from that same source image's pixels instead of from
// these constants — a different extraction method, but the same real
// reference, so the two should always read as the same mark. If the source
// artwork ever changes, re-measure both.
export const STROKE_WIDTH = 20.09;

export const LEFT_TOP = { x: 19.06, y: 39.55 };
export const LEFT_BOTTOM = { x: 19.06, y: 84.96 };
export const RIGHT_TOP = { x: 81.14, y: 39.55 };
export const RIGHT_BOTTOM = { x: 81.14, y: 84.96 };

// The diagonal band is its own stroke, not a leg-to-leg join — measured
// off its own visible centerline, which sits slightly inboard of dead
// center on each upright (matching the real artwork's woven/interlace
// look), not exactly through LEFT_TOP/RIGHT_BOTTOM.
export const DIAGONAL_TOP = { x: 28.5, y: 39.55 };
export const DIAGONAL_BOTTOM = { x: 73.91, y: 84.96 };

export const LEFT_HEAD = { cx: 19.26, cy: 14.24, r: 9.34 };
export const RIGHT_HEAD = { cx: 81.34, cy: 14.24, r: 9.24 };

// Drawn in this order (uprights first, diagonal last) so the diagonal band
// reads as crossing over both uprights, matching the real artwork.
export const MARK_STROKES = [
  [LEFT_TOP, LEFT_BOTTOM],
  [RIGHT_TOP, RIGHT_BOTTOM],
  [DIAGONAL_TOP, DIAGONAL_BOTTOM],
];

export const MARK_HEADS = [LEFT_HEAD, RIGHT_HEAD];

// The approved palette (assets/branding/nearby-brand-final.png).
export const BRAND_CORAL = '#FF5A5F';
export const BRAND_PINK = '#FF7A59';
export const BRAND_PEACH = '#FFA35C';
export const BRAND_CREAM = '#FFD9B8';
export const BRAND_WHITE = '#FFF6F0';
