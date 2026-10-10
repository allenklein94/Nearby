// Offer and creative-library media screening (one path for both). Pure: storage, the image classifier and the recorder are
// injected, so the same code runs in the edge function and in Jest.
//
// Order is the rule (owner, 2026-10-10, LOCKED):
//   1. the file is this business's own, a video carries 1-3 own preview frames, and is at most 25 MB;
//   2. a video's LENGTH is checked on the server from the file itself (videoDuration.js, MP4 / MOV only) BEFORE any
//      content screening: too long, unreadable, contradictory or another format = refused here, and the classifier is
//      never called;
//   3. only a video that passed is recorded in business_video_checks (the database refuses a video on a ready creative or
//      an offer without that record, whatever path writes it);
//   4. then the image / sampled frames are classified, worst tier wins.
// Results: { tier, categories, reasoning, posterPath } | { status: 400, error, code? } | { status: 503, service: true }.
// A storage or classifier failure is always { service: true } (retry), never an approval and never "needs changes".

import { checkVideoDuration, VIDEO_CHECK_MESSAGES } from './videoDuration.js';

export const OFFER_MEDIA_BUCKET = 'business-offer-media';
export const MAX_OFFER_VIDEO_BYTES = 25 * 1024 * 1024;

const VIDEO_CODES = { too_long: 'video_too_long', unreadable: 'video_length_unchecked', unsupported: 'video_format_unsupported' };

// A byte-range reader over a signed storage URL. Anything but an exact 206 answer for the asked range, of a file of the
// size the listing reported, is a service failure (thrown), so the length check can never run on a different file.
export function rangeReader(url, size, fetchFn) {
  return {
    size,
    async read(offset, length) {
      const res = await fetchFn(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (res.status !== 206) throw new Error(`storage range read answered ${res.status}`);
      const total = Number(String(res.headers.get('content-range') || '').split('/')[1]);
      if (total !== size) throw new Error('storage range read: file size changed');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length !== length) throw new Error('storage range read: short answer');
      return bytes;
    },
  };
}

// deps: { storage: { list(partnerId, name) -> {size}|null, signedUrl(path) -> string|null }, fetchFn, classifyImage(url),
//         worseTier(a, b), recordVideoCheck(partnerId, path, durationMs) -> boolean, log? }
export async function screenOfferMedia(deps, partnerId, mediaPath, mediaType, framePaths) {
  const folder = `${partnerId}/`;
  const own = (p) => typeof p === 'string' && p.startsWith(folder) && !p.includes('..') && p.length < 300;
  if (!own(mediaPath)) return { status: 400, error: 'That photo or video is not available to send.' };
  if (mediaType !== 'image' && mediaType !== 'video') return { status: 400, error: 'Invalid media type' };
  if (mediaType === 'video') {
    if (!Array.isArray(framePaths) || framePaths.length < 1 || framePaths.length > 3 || !framePaths.every(own)) {
      return { status: 400, error: 'A video needs preview images. Please attach it again.' };
    }
    let listed;
    try {
      listed = await deps.storage.list(partnerId, mediaPath.slice(folder.length));
    } catch (e) {
      deps.log?.('video listing failed', e);
      return { status: 503, service: true };
    }
    const size = listed?.size;
    if (!Number.isSafeInteger(size) || size <= 0) return { status: 400, error: 'We could not read that video. Please attach it again.' };
    if (size > MAX_OFFER_VIDEO_BYTES) return { status: 400, error: 'That video is too large (max 25MB). Try a shorter clip.' };

    let check;
    try {
      const url = await deps.storage.signedUrl(mediaPath);
      if (!url) throw new Error('no signed url');
      check = await checkVideoDuration(rangeReader(url, size, deps.fetchFn));
    } catch (e) {
      deps.log?.('video length check could not run', e);
      return { status: 503, service: true };
    }
    if (!check.ok) {
      deps.log?.('video refused before screening', { reason: check.reason, detail: check.detail, durationMs: check.durationMs });
      return { status: 400, error: VIDEO_CHECK_MESSAGES[check.reason], code: VIDEO_CODES[check.reason] };
    }
    let recorded = false;
    try { recorded = await deps.recordVideoCheck(partnerId, mediaPath, check.durationMs); } catch (e) { deps.log?.('video check record failed', e); }
    if (!recorded) return { status: 503, service: true };
  }

  const toCheck = mediaType === 'video' ? framePaths : [mediaPath];
  let tier = 'low';
  const categories = [];
  const notes = [];
  for (const path of toCheck) {
    const url = await deps.storage.signedUrl(path);
    if (!url) return { status: 400, error: 'We could not read that photo or video. Please attach it again.' };
    const r = await deps.classifyImage(url);
    if ('error' in r) {
      if (r.service) return { status: 503, service: true };
      return { status: 400, error: "That photo or video preview couldn't be read. Try a different one." };
    }
    tier = deps.worseTier(tier, r.riskTier);
    for (const c of r.matchedCategories) if (!categories.includes(c)) categories.push(c);
    notes.push(r.reasoning);
  }
  return {
    tier, categories,
    reasoning: `Media (${mediaType}${mediaType === 'video' ? `, ${toCheck.length} sampled frame(s)` : ''}): ${notes.join(' ')}`,
    posterPath: mediaType === 'video' ? framePaths[0] : null,
  };
}
