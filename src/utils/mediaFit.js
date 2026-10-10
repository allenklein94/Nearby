// Item 10 (owner, 2026-10-10): a business uploads what it already has (a photo, a graphic, an offer flyer, a phone video,
// a wordmark logo) and Nearby formats it. Presentation only: nothing is re-encoded, cropped on disk or stored.
//
// Offer media sits in a fixed frame (full width x 180). A photo shaped roughly like the frame fills it ("cover": at most a
// small, even crop). Anything shaped differently (a portrait flyer, a square graphic with text, a 9:16 phone video's
// poster) is shown WHOLE ("contain") over a blurred copy of itself, so no text or product is cut off and there are no bars.
// Unknown size = shown whole (never crop what was not measured).

// How far the image's shape may differ from the frame's before cropping would cut too much (1.25 = up to ~20% trimmed).
export const COVER_TOLERANCE = 1.25;

export function aspectOf(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

// -> 'cover' | 'contain'
export function mediaFitMode(imageWidth, imageHeight, frameWidth, frameHeight) {
  const img = aspectOf(imageWidth, imageHeight);
  const frame = aspectOf(frameWidth, frameHeight);
  if (img == null || frame == null) return 'contain';
  const ratio = img > frame ? img / frame : frame / img;
  return ratio <= COVER_TOLERANCE ? 'cover' : 'contain';
}

// Logos are identity: a wordmark must never be cropped into a circle, so a logo is always shown whole, inset in its mark.
export const LOGO_FIT = 'contain';
