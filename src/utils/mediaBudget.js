// Owner item 22 (2026-10-11): strict performance rules for offer media on a real phone. Nothing here changes what is
// screened or shown, only how heavy it is: a photo is shrunk ON THE PHONE before it is uploaded, so every customer later
// downloads a sensible file instead of a 12-megapixel original shown in a 180 px frame.
//   - offer / creative / experience photos and video poster frames: at most 1600 px on the long side, JPEG
//   - logos: at most 512 px (they are drawn at 20-40 px), keeping PNG when the original is PNG (transparency)
//   - videos are never transcoded: they stay within the 30 s / 25 MB caps (utils/offerMedia.js), are never preloaded and
//     download only after the person taps play (components/OfferMedia.js)
// A smaller original is uploaded as is (never upscaled); unknown dimensions are left as is.

export const OFFER_IMAGE_MAX_PX = 1600;
export const LOGO_MAX_PX = 512;
export const UPLOAD_JPEG_QUALITY = 0.75;

// The one resize action for an image of width x height, or null when it already fits / its size is unknown.
export function uploadResize(width, height, maxPx = OFFER_IMAGE_MAX_PX) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (Math.max(w, h) <= maxPx) return null;
  return w >= h ? { width: maxPx } : { height: maxPx };
}

// Item 22 (avoid repeat downloads): a signed media address is new every time it is asked for, and a new address is a new
// download, so the same offer photo was fetched again on every card mount. One address per path is reused while it has
// plenty of life left (signed for SIGNED_URL_LIFETIME_S, reused for SIGNED_URL_REUSE_MS), and concurrent asks share one
// request. A failed ask (null) is never cached.
export const SIGNED_URL_LIFETIME_S = 3600;
export const SIGNED_URL_REUSE_MS = 50 * 60 * 1000;

export function createSignedUrlCache({ reuseMs = SIGNED_URL_REUSE_MS, now = () => Date.now(), maxEntries = 200 } = {}) {
  const entries = new Map(); // path -> { url, at } | { pending }
  return function cached(path, fetchUrl) {
    if (!path) return Promise.resolve(null);
    const hit = entries.get(path);
    if (hit?.pending) return hit.pending;
    if (hit && now() - hit.at < reuseMs) return Promise.resolve(hit.url);
    const pending = Promise.resolve()
      .then(() => fetchUrl(path))
      .catch(() => null)
      .then((url) => {
        if (url) {
          entries.delete(path);
          entries.set(path, { url, at: now() });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        } else {
          entries.delete(path);
        }
        return url ?? null;
      });
    entries.set(path, { pending });
    return pending;
  };
}
