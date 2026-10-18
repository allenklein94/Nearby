// Item 10 (owner, 2026-10-10): a business uploads what it already has (a photo, a graphic, an offer flyer, a phone video,
// a wordmark logo) and Nearby formats it. Presentation only: nothing is re-encoded, cropped on disk or stored.
//
// Offer media sits in a fixed frame (full width x 180). Every image is shown WHOLE ("contain"), whatever its shape (owner,
// idea "191", 2026-10-18: reply media is never cropped, not even a photo shaped almost like the frame; this retired item
// 10's near-frame "cover" case). Space the image doesn't cover shows a blurred copy of itself, so there are no hard bars.
export const OFFER_MEDIA_FIT = 'contain';

export function aspectOf(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

// Logos are identity: a wordmark must never be cropped into a circle, so a logo is always shown whole, inset in its mark.
export const LOGO_FIT = 'contain';

// The largest box of the logo's own shape that fits inside the circle (its corners touch the curve, nothing crosses it):
// a 4:1 wordmark gets ~97% of the width, a square ~71%. Unknown shape = the square box (safe for any logo).
// -> { width, height } in the same units as diameter.
export function logoBox(imageWidth, imageHeight, diameter) {
  const a = aspectOf(imageWidth, imageHeight) ?? 1;
  const k = Math.sqrt(1 + a * a);
  return { width: (diameter * a) / k, height: diameter / k };
}
