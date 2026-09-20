// Rich offers, Phase 2 (PRODUCT_AUDIT/OFFER_MEDIA_MODEL_2026-09-20.md). Pure rules shared by the sender and the tests.
// A video offer is screened through up to three preview frames sampled from it (the first becomes its poster); the server
// enforces the same size cap and refuses a video with no frames.

export const MAX_OFFER_VIDEO_MS = 30 * 1000;
export const MAX_OFFER_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_REDEMPTION_LENGTH = 500;

// Times (ms) to sample: start, middle, near the end. A short/unknown clip gets fewer, distinct, in-range times.
export function videoFrameTimes(durationMs) {
  const d = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (d < 1500) return [0];
  const last = Math.max(0, Math.floor(d) - 500);
  return [...new Set([0, Math.floor(d / 2), last])];
}

// A plain-words problem with a picked video, or null when it is fine. Images are never limited here.
export function videoLimitProblem(asset) {
  if (!asset || asset.type !== 'video') return null;
  if (Number.isFinite(asset.duration) && asset.duration > MAX_OFFER_VIDEO_MS) return 'That video is longer than 30 seconds. Trim it or pick a shorter clip.';
  if (Number.isFinite(asset.fileSize) && asset.fileSize > MAX_OFFER_VIDEO_BYTES) return 'That video is larger than 25MB. Pick a shorter clip.';
  return null;
}

// Redemption instructions shown to the customer only once the offer is theirs (accepted/completed).
export function visibleRedemption(offer) {
  const text = typeof offer?.redemption_instructions === 'string' ? offer.redemption_instructions.trim() : '';
  if (!text) return null;
  return offer.status === 'accepted' || offer.status === 'completed' ? text : null;
}
