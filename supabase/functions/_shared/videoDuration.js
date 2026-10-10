// Server-side video length check for MP4 / MOV (owner, 2026-10-10, Option A, LOCKED).
//
// The phone already refuses a video over 30 s or with no known length, but a phone's word is not proof: a direct API call
// can upload anything. This reads the container's own timing boxes (ISO BMFF / QuickTime: ftyp, moov > mvhd, trak > tkhd,
// mdia > mdhd / hdlr, minf > stbl > stts, edts > elst) through a byte-range reader and answers ONE of:
//   { ok: true, durationMs }                     a supported video whose timing agrees with itself, <= 30 s
//   { ok: false, reason: 'too_long', durationMs } readable and consistent, but longer than 30 s (never trimmed)
//   { ok: false, reason: 'unsupported' }          not an MP4 / MOV we accept (other formats are refused until supported)
//   { ok: false, reason: 'unreadable', detail }   malformed, missing, contradictory or over a resource limit (fail closed)
// A reader failure (storage unreachable) is THROWN, never returned: the caller treats it as a service failure (retry),
// so an outage can never turn into an approval or into a "needs changes" verdict about the file.
//
// Pure: no Deno or Node APIs, so the same file runs in the edge function and in Jest. Every loop is bounded (bytes read,
// boxes, nesting depth, tracks, table entries, wall time); anything unexpected is refused, never guessed.

export const MAX_VIDEO_MS = 30000;

export const LIMITS = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024, // same cap as the upload rule
  maxBytesRead: 4 * 1024 * 1024, // total bytes this check may read from the file
  maxMoovBytes: 2 * 1024 * 1024, // a 30 s clip's movie box is a few KB to a few hundred KB
  maxTopLevelBoxes: 64,
  maxBoxes: 4096,
  maxDepth: 8,
  maxTracks: 16,
  maxSttsEntries: 20000, // 30 s at 240 fps with every frame different is 7200
  maxElstEntries: 64,
  maxMillis: 1500,
});

// Brands of plain MP4 and QuickTime MOV (iPhone writes 'qt  ', Android 'mp42' / 'isom'). Anything else is 'unsupported'.
const ACCEPTED_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ']);
// Only these boxes are entered; every other box is skipped by its size, never parsed.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
// The tolerance two timing fields may disagree by before the file counts as contradictory.
const TOLERANCE_MS = 100;
const UNKNOWN32 = 0xffffffffn;
const UNKNOWN64 = 0xffffffffffffffffn;

class Refusal extends Error {
  constructor(reason, detail) { super(detail); this.reason = reason; this.detail = detail; }
}
const unreadable = (detail) => { throw new Refusal('unreadable', detail); };

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b, o) => BigInt(((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]);
const u64 = (b, o) => (u32(b, o) << 32n) + u32(b, o + 4);
const s32 = (b, o) => { const v = u32(b, o); return v >= 0x80000000n ? v - 0x100000000n : v; };
const s64 = (b, o) => { const v = u64(b, o); return v >= 0x8000000000000000n ? v - 0x10000000000000000n : v; };
const u16 = (b, o) => (b[o] << 8) + b[o + 1];
// units / timescale in whole milliseconds, rounded (the same precision the phone reports)
const toMs = (units, timescale) => Number((units * 1000n + timescale / 2n) / timescale);

// reader: { size: number, read(offset: number, length: number): Promise<Uint8Array> } ; read() throws on a service failure
// and must return exactly `length` bytes (a short read is a service failure too).
export async function checkVideoDuration(reader, opts = {}) {
  const limits = { ...LIMITS, ...(opts.limits || {}) };
  const now = opts.now || (() => Date.now());
  const started = now();
  let bytesRead = 0;
  let boxes = 0;
  // tick(): one more box (counted) and a clock check; tick(false): a clock check only (inside a long table)
  const tick = (box = true) => {
    if (now() - started > limits.maxMillis) unreadable('took too long');
    if (box && ++boxes > limits.maxBoxes) unreadable('too many boxes');
  };
  const read = async (offset, length) => {
    if (length < 0 || offset < 0 || offset + length > size) unreadable('read past the end');
    bytesRead += length;
    if (bytesRead > limits.maxBytesRead) unreadable('read limit');
    const out = await reader.read(offset, length);
    if (!out || out.length !== length) throw new Error('short read from storage');
    return out;
  };

  const size = reader?.size;
  try {
    if (!Number.isSafeInteger(size) || size < 16) unreadable('empty or unknown size');
    if (size > limits.maxFileBytes) unreadable('file too large');

    // ---- top level: ftyp first, exactly one moov, no fragments; mdat and friends are skipped without reading them ----
    let offset = 0;
    let topCount = 0;
    let moov = null;
    let first = true;
    while (offset < size) {
      tick();
      if (++topCount > limits.maxTopLevelBoxes) unreadable('too many top-level boxes');
      if (size - offset < 8) unreadable('trailing bytes');
      const head = await read(offset, Math.min(16, size - offset));
      let boxSize = u32(head, 0);
      const type = fourcc(head, 4);
      // not an ISO BMFF / QuickTime file at all (WebM, AVI, ...): a format we do not accept yet, said before anything else
      if (first && type !== 'ftyp') throw new Refusal('unsupported', `first box is ${JSON.stringify(type)}`);
      let headerLen = 8;
      if (boxSize === 1n) {
        if (head.length < 16) unreadable('truncated large box');
        boxSize = u64(head, 8);
        headerLen = 16;
      } else if (boxSize === 0n) {
        boxSize = BigInt(size - offset); // runs to the end of the file
      }
      if (boxSize < BigInt(headerLen) || boxSize > BigInt(size - offset)) unreadable(`bad size for ${type}`);
      const len = Number(boxSize);
      if (first) {
        if (len < 16 || len > 1024) unreadable('bad ftyp');
        const ftyp = await read(offset, len);
        const brands = [fourcc(ftyp, 8)];
        for (let o = 16; o + 4 <= len; o += 4) brands.push(fourcc(ftyp, o));
        if (!brands.some((b) => ACCEPTED_BRANDS.has(b))) throw new Refusal('unsupported', `brands ${brands.join(',')}`);
        first = false;
      } else if (type === 'moov') {
        if (moov) unreadable('more than one moov');
        if (len > limits.maxMoovBytes) unreadable('moov too large');
        moov = { start: offset + headerLen, end: offset + len };
      } else if (type === 'moof' || type === 'mfra' || type === 'sidx') {
        unreadable('fragmented video');
      }
      offset += len;
    }
    if (!moov) unreadable('no moov');

    const buf = await read(moov.start, moov.end - moov.start);
    const movie = { mvhd: null, tracks: [], mvex: false };
    parseChildren(buf, 0, buf.length, 1, { kind: 'moov', movie }, limits, tick);
    return judge(movie);
  } catch (e) {
    if (e instanceof Refusal) return e.reason === 'unsupported' ? { ok: false, reason: 'unsupported', detail: e.detail } : { ok: false, reason: 'unreadable', detail: e.detail };
    throw e; // storage / service failure: the caller retries, never approves
  }
}

function parseChildren(b, start, end, depth, ctx, limits, tick) {
  if (depth > limits.maxDepth) unreadable('nested too deep');
  let o = start;
  while (o < end) {
    tick();
    if (end - o < 8) unreadable('trailing bytes in a box');
    let boxSize = u32(b, o);
    const type = fourcc(b, o + 4);
    let headerLen = 8;
    if (boxSize === 1n) {
      if (end - o < 16) unreadable('truncated large box');
      boxSize = u64(b, o + 8);
      headerLen = 16;
    } else if (boxSize === 0n) {
      unreadable(`open-ended ${type} inside the movie`);
    }
    if (boxSize < BigInt(headerLen) || boxSize > BigInt(end - o)) unreadable(`bad size for ${type}`);
    const boxEnd = o + Number(boxSize);
    const body = o + headerLen;
    visit(b, type, body, boxEnd, depth, ctx, limits, tick);
    o = boxEnd;
  }
}

function visit(b, type, s, e, depth, ctx, limits, tick) {
  const movie = ctx.movie;
  if (ctx.kind === 'moov') {
    if (type === 'mvhd') {
      if (movie.mvhd) unreadable('two mvhd');
      movie.mvhd = fullDuration(b, s, e, 'mvhd');
    } else if (type === 'trak') {
      if (movie.tracks.length >= limits.maxTracks) unreadable('too many tracks');
      const track = { tkhd: null, mdhd: null, handler: null, stts: null, elst: null };
      movie.tracks.push(track);
      parseChildren(b, s, e, depth + 1, { kind: 'trak', movie, track }, limits, tick);
    } else if (type === 'mvex') {
      unreadable('fragmented video');
    }
    return;
  }
  const t = ctx.track;
  if (type === 'tkhd') {
    if (ctx.kind !== 'trak') return;
    if (t.tkhd) unreadable('two tkhd');
    t.tkhd = tkhdDuration(b, s, e);
  } else if (type === 'mdhd') {
    if (ctx.kind !== 'mdia') return;
    if (t.mdhd) unreadable('two mdhd');
    t.mdhd = fullDuration(b, s, e, 'mdhd');
  } else if (type === 'hdlr') {
    if (ctx.kind !== 'mdia') return; // a QuickTime minf may carry a data-handler hdlr; only the media's own one counts
    if (t.handler) unreadable('two hdlr');
    if (e - s < 12) unreadable('short hdlr');
    t.handler = fourcc(b, s + 8);
  } else if (type === 'stts') {
    if (ctx.kind !== 'stbl') return;
    if (t.stts) unreadable('two stts');
    t.stts = sttsTotal(b, s, e, limits, tick);
  } else if (type === 'elst') {
    if (ctx.kind !== 'edts') return;
    if (t.elst) unreadable('two elst');
    t.elst = elstTotal(b, s, e, limits);
  } else if (CONTAINERS.has(type) && type !== 'moov' && type !== 'trak') {
    parseChildren(b, s, e, depth + 1, { kind: type, movie, track: t }, limits, tick);
  } else if (type === 'trak' || type === 'moov') {
    unreadable(`${type} in the wrong place`);
  }
}

// mvhd / mdhd: version 0 = 32-bit times, version 1 = 64-bit. -> { timescale, duration } (BigInt)
function fullDuration(b, s, e, name) {
  if (e - s < 4) unreadable(`short ${name}`);
  const version = b[s];
  if (version === 0) {
    if (e - s < 20) unreadable(`short ${name}`);
    const timescale = u32(b, s + 12);
    const duration = u32(b, s + 16);
    return checkTime(timescale, duration === UNKNOWN32 ? null : duration, name);
  }
  if (version === 1) {
    if (e - s < 32) unreadable(`short ${name}`);
    const timescale = u32(b, s + 20);
    const duration = u64(b, s + 24);
    return checkTime(timescale, duration === UNKNOWN64 ? null : duration, name);
  }
  return unreadable(`${name} version ${version}`);
}

function checkTime(timescale, duration, name) {
  if (timescale === 0n) unreadable(`${name} timescale 0`);
  if (duration === null || duration === 0n) unreadable(`${name} has no duration`);
  return { timescale, duration };
}

// tkhd duration is in the MOVIE timescale. -> BigInt or null when the file says "unknown"
function tkhdDuration(b, s, e) {
  if (e - s < 4) unreadable('short tkhd');
  const version = b[s];
  if (version === 0) {
    if (e - s < 24) unreadable('short tkhd');
    const d = u32(b, s + 20);
    return d === UNKNOWN32 ? null : d;
  }
  if (version === 1) {
    if (e - s < 36) unreadable('short tkhd');
    const d = u64(b, s + 28);
    return d === UNKNOWN64 ? null : d;
  }
  return unreadable(`tkhd version ${version}`);
}

// Sum of sample_count * sample_delta (media timescale). -> BigInt
function sttsTotal(b, s, e, limits, tick) {
  if (e - s < 8) unreadable('short stts');
  const count = u32(b, s + 4);
  if (count === 0n) unreadable('empty stts');
  if (count > BigInt(limits.maxSttsEntries)) unreadable('stts too large');
  const n = Number(count);
  if (e - s < 8 + n * 8) unreadable('stts shorter than its count');
  let total = 0n;
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 0) tick(false);
    total += u32(b, s + 8 + i * 8) * u32(b, s + 12 + i * 8);
  }
  if (total === 0n) unreadable('stts adds up to nothing');
  return total;
}

// Edit list: total presented length (movie timescale), refusing any edit that plays at another speed. -> BigInt
function elstTotal(b, s, e, limits) {
  if (e - s < 8) unreadable('short elst');
  const version = b[s];
  if (version !== 0 && version !== 1) unreadable(`elst version ${version}`);
  const count = Number(u32(b, s + 4));
  if (count < 1) unreadable('empty elst');
  if (count > limits.maxElstEntries) unreadable('elst too large');
  const entry = version === 1 ? 20 : 12;
  if (e - s < 8 + count * entry) unreadable('elst shorter than its count');
  let total = 0n;
  for (let i = 0; i < count; i++) {
    const o = s + 8 + i * entry;
    const segment = version === 1 ? u64(b, o) : u32(b, o);
    const mediaTime = version === 1 ? s64(b, o + 8) : s32(b, o + 8);
    const rate = u16(b, o + (version === 1 ? 16 : 8));
    const rateFraction = u16(b, o + (version === 1 ? 18 : 10));
    // an empty edit (mediaTime -1) is a pause; everything else must play at normal speed
    if (mediaTime !== -1n && (rate !== 1 || rateFraction !== 0)) unreadable('edit plays at another speed');
    total += segment;
  }
  return total;
}

function judge(movie) {
  const mvhd = movie.mvhd || unreadable('no mvhd');
  const movieMs = toMs(mvhd.duration, mvhd.timescale);
  const video = movie.tracks.filter((t) => t.handler === 'vide');
  if (video.length === 0) unreadable('no video track');
  if (video.length > 1) unreadable('more than one video track');
  const lengths = [movieMs];
  for (const t of movie.tracks) {
    if (!t.handler) unreadable('a track has no handler');
    if (t.tkhd === null) unreadable('a track has no length');
    const tkMs = toMs(t.tkhd, mvhd.timescale);
    // the movie is as long as its longest track: a track longer than the movie, or a movie longer than every track, contradicts
    if (tkMs > movieMs + TOLERANCE_MS) unreadable('a track is longer than the movie');
    if (t.elst !== null && Math.abs(toMs(t.elst, mvhd.timescale) - tkMs) > TOLERANCE_MS) unreadable('edit list disagrees with the track');
    lengths.push(tkMs);
  }
  if (movieMs > Math.max(...lengths.slice(1)) + TOLERANCE_MS) unreadable('the movie is longer than every track');

  const v = video[0];
  if (!v.mdhd) unreadable('video has no mdhd');
  if (v.stts === null) unreadable('video has no sample timing');
  const mediaMs = toMs(v.mdhd.duration, v.mdhd.timescale);
  const samplesMs = toMs(v.stts, v.mdhd.timescale);
  if (Math.abs(mediaMs - samplesMs) > TOLERANCE_MS) unreadable('video timing disagrees with its samples');
  // without an edit list the presented video is the media itself, so the track header must agree with it
  if (v.elst === null && Math.abs(mediaMs - toMs(v.tkhd, mvhd.timescale)) > TOLERANCE_MS) unreadable('video track length disagrees with its media');
  // the video media itself counts too, so an edit list can never hide a longer clip from the limit
  lengths.push(mediaMs, samplesMs);

  const durationMs = Math.max(...lengths);
  if (durationMs > MAX_VIDEO_MS) return { ok: false, reason: 'too_long', durationMs };
  return { ok: true, durationMs };
}

// The owner-facing words for each refusal (English source; the app shows them in the person's language by key).
export const VIDEO_CHECK_MESSAGES = Object.freeze({
  too_long: 'Videos can be up to 30 seconds. Trim it on your phone and try again.',
  unreadable: "We couldn't check this video's length.",
  unsupported: "This video format isn't supported. Use an MP4 or MOV video.",
});
