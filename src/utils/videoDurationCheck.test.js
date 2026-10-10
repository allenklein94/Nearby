import fs from 'fs';
import path from 'path';
import { checkVideoDuration, LIMITS, MAX_VIDEO_MS, VIDEO_CHECK_MESSAGES } from '../../supabase/functions/_shared/videoDuration';
import { screenOfferMedia, rangeReader } from '../../supabase/functions/_shared/offerMediaScreening';

// Server-side video length check (owner, 2026-10-10, Option A, LOCKED). The fixtures in __fixtures__/video are REAL encoded
// files (H.264 + AAC, 32x32, 10 fps, made with ffmpeg 7.0.2): 29.9 / 30.0 / 30.1 s as MP4 and as QuickTime MOV, a
// fragmented MP4, two video streams, a video-only MP4, a fast-start MP4 and a WebM. Contradictions are made by patching
// single fields of a real file; structural limits by small synthetic files built below.

const DIR = path.join(__dirname, '__fixtures__/video');
const file = (name) => fs.readFileSync(path.join(DIR, name));

function memReader(buf, size = buf.length) {
  const stats = { reads: 0, bytes: 0 };
  return {
    stats,
    size,
    read: async (o, l) => {
      stats.reads += 1;
      stats.bytes += l;
      const out = new Uint8Array(l);
      if (o < buf.length) out.set(buf.subarray(o, Math.min(o + l, buf.length)));
      return out;
    },
  };
}
const check = (buf, opts) => checkVideoDuration(memReader(buf), opts);

// ---- box helpers ----
const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'];
// every box of `type` in a real file -> [{ start (box start), body (after header), end }]
function findAll(buf, type, start = 0, end = buf.length, out = []) {
  let o = start;
  while (o + 8 <= end) {
    let size = buf.readUInt32BE(o);
    const t = buf.toString('latin1', o + 4, o + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); header = 16; }
    if (size === 0) size = end - o;
    if (t === type) out.push({ start: o, body: o + header, end: o + size });
    if (CONTAINERS.includes(t)) findAll(buf, type, o + header, o + size, out);
    o += size;
  }
  return out;
}
const copy = (name) => Buffer.from(file(name));
// the video trak's box of `type` (hdlr 'vide')
function videoBox(buf, type) {
  const trak = findAll(buf, 'trak').find((tk) => findAll(buf, 'hdlr', tk.body, tk.end).some((h) => buf.toString('latin1', h.body + 8, h.body + 12) === 'vide'));
  return findAll(buf, type, trak.body, trak.end)[0];
}
const audioTrak = (buf) => findAll(buf, 'trak').find((tk) => findAll(buf, 'hdlr', tk.body, tk.end).some((h) => buf.toString('latin1', h.body + 8, h.body + 12) === 'soun'));

// synthetic files: box(type, ...children|Buffer)
const box = (type, ...parts) => {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b; };
const ftyp = (brand = 'isom') => box('ftyp', Buffer.from(brand, 'latin1'), u32(512), Buffer.from(`${brand}mp41`, 'latin1'));
const mvhd = (ts, dur) => box('mvhd', u32(0, 0, 0, ts, dur), Buffer.alloc(80));
const tkhd = (dur) => box('tkhd', u32(0, 0, 0, 1, 0, dur), Buffer.alloc(60));
const mdhd = (ts, dur) => box('mdhd', u32(0, 0, 0, ts, dur, 0));
const hdlr = (h) => box('hdlr', u32(0, 0), Buffer.from(h, 'latin1'), u32(0, 0, 0), Buffer.from([0]));
const stts = (entries) => box('stts', u32(0, entries.length), ...entries.map(([c, d]) => u32(c, d)));
const elst = (entries) => box('elst', u32(0, entries.length), ...entries.map(([seg, mt, rate = 1]) => Buffer.concat([u32(seg, mt), Buffer.from([rate >> 8, rate & 255, 0, 0])])));
// a track: seconds of media at 1000 units/s, sampled at 10 fps
const track = (handler, secs, { tk = secs, edit = null, sttsEntries = null, wrapDepth = 0 } = {}) => {
  let minf = box('minf', box('stbl', stts(sttsEntries || [[secs * 10, 100]])));
  let mdia = box('mdia', mdhd(1000, secs * 1000), hdlr(handler), minf);
  for (let i = 0; i < wrapDepth; i++) mdia = box('mdia', mdia);
  return box('trak', tkhd(tk * 1000), ...(edit ? [box('edts', elst(edit))] : []), mdia);
};
const movie = (secs, tracks, extraTop = []) => Buffer.concat([ftyp(), box('moov', mvhd(1000, secs * 1000), ...tracks), ...extraTop, box('mdat', Buffer.alloc(16))]);

describe('genuine videos at the 30-second boundary', () => {
  it.each([
    ['clip-29.9.mp4', true, 29900],
    ['clip-30.0.mp4', true, 30000],
    ['clip-30.1.mp4', false, 30100],
    ['clip-29.9.mov', true, 29900],
    ['clip-30.0.mov', true, 30000],
    ['clip-30.1.mov', false, 30100],
  ])('%s', async (name, ok, ms) => {
    const r = await check(file(name));
    expect(r.durationMs).toBe(ms);
    expect(r.ok).toBe(ok);
    if (!ok) expect(r.reason).toBe('too_long');
  });

  it('exactly 30 s passes, anything longer does not, and the limit is 30 s', () => {
    expect(MAX_VIDEO_MS).toBe(30000);
  });

  it('a video-only file and a fast-start file (moov before mdat) are read the same way', async () => {
    expect(await check(file('video-only-10.mp4'))).toEqual({ ok: true, durationMs: 10000 });
    expect(await check(file('faststart-8.mp4'))).toEqual({ ok: true, durationMs: 8000 });
  });

  it('the movie data is skipped, never read: a check reads a small fraction of the file', async () => {
    const buf = file('clip-30.0.mp4');
    const r = memReader(buf);
    await checkVideoDuration(r);
    expect(r.stats.bytes).toBeLessThan(buf.length / 2);
  });
});

describe('other formats and structures are refused safely', () => {
  it('WebM is unsupported', async () => {
    expect(await check(file('clip-10.webm'))).toMatchObject({ ok: false, reason: 'unsupported' });
  });
  it('a file whose brands are not MP4 / MOV is unsupported', async () => {
    const buf = Buffer.concat([box('ftyp', Buffer.from('heic', 'latin1'), u32(0), Buffer.from('mif1', 'latin1')), box('mdat', Buffer.alloc(8))]);
    expect(await check(buf)).toMatchObject({ ok: false, reason: 'unsupported' });
  });
  it('a fragmented MP4 is refused (its length is not in one place)', async () => {
    expect(await check(file('frag-12.mp4'))).toMatchObject({ ok: false, reason: 'unreadable', detail: 'fragmented video' });
  });
  it('two video streams are refused', async () => {
    expect(await check(file('two-video-10.mp4'))).toMatchObject({ ok: false, reason: 'unreadable', detail: 'more than one video track' });
  });
  it('no video stream is refused', async () => {
    expect(await check(movie(10, [track('soun', 10)]))).toMatchObject({ ok: false, reason: 'unreadable', detail: 'no video track' });
  });
  it('a synthetic well-formed file passes, so the refusals below are about their one change', async () => {
    expect(await check(movie(12, [track('vide', 12), track('soun', 12)]))).toEqual({ ok: true, durationMs: 12000 });
  });
});

describe('missing and contradictory timing', () => {
  it('a movie length of 0 is missing', async () => {
    const b = copy('clip-30.0.mp4');
    b.writeUInt32BE(0, findAll(b, 'mvhd')[0].body + 16);
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'mvhd has no duration' });
  });
  it('a movie length marked unknown (all ones) is missing', async () => {
    const b = copy('clip-30.0.mp4');
    b.writeUInt32BE(0xffffffff, findAll(b, 'mvhd')[0].body + 16);
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'mvhd has no duration' });
  });
  it('a timescale of 0 is unreadable', async () => {
    const b = copy('clip-30.0.mov');
    b.writeUInt32BE(0, findAll(b, 'mvhd')[0].body + 12);
    expect(await check(b)).toMatchObject({ reason: 'unreadable' });
  });
  it('no movie header at all is unreadable', async () => {
    const b = copy('clip-29.9.mp4');
    b.write('xxxx', findAll(b, 'mvhd')[0].start + 4, 'latin1');
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'no mvhd' });
  });
  it('a movie that claims 10 s while its tracks run 30 s is contradictory (a short header cannot sneak a long clip in)', async () => {
    const b = copy('clip-30.0.mp4');
    const m = findAll(b, 'mvhd')[0];
    b.writeUInt32BE(Math.round(b.readUInt32BE(m.body + 16) / 3), m.body + 16);
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'a track is longer than the movie' });
  });
  it('a movie that claims longer than every track is contradictory', async () => {
    const b = copy('clip-29.9.mp4');
    const m = findAll(b, 'mvhd')[0];
    b.writeUInt32BE(b.readUInt32BE(m.body + 16) * 2, m.body + 16);
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'the movie is longer than every track' });
  });
  it('video media length disagreeing with its own samples is contradictory', async () => {
    const b = copy('clip-29.9.mov');
    const md = videoBox(b, 'mdhd');
    b.writeUInt32BE(Math.round(b.readUInt32BE(md.body + 16) / 2), md.body + 16);
    expect(await check(b)).toMatchObject({ reason: 'unreadable' });
  });
  it('sample timing changed alone is contradictory', async () => {
    const b = copy('clip-29.9.mp4');
    const st = videoBox(b, 'stts');
    b.writeUInt32BE(b.readUInt32BE(st.body + 12) * 3, st.body + 12); // first entry's delta
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'video timing disagrees with its samples' });
  });
  it('a video with no sample timing is unreadable', async () => {
    const b = copy('clip-29.9.mp4');
    b.write('xxxx', videoBox(b, 'stts').start + 4, 'latin1');
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'video has no sample timing' });
  });
  it('an edit list that hides a longer clip behind a short header still counts the whole clip', async () => {
    // 60 s of video media, presented as 20 s through an edit list, in a 20 s movie: refused as too long, never 20 s
    const f = movie(20, [track('vide', 60, { tk: 20, edit: [[20000, 0]] })]);
    expect(await check(f)).toMatchObject({ ok: false, reason: 'too_long', durationMs: 60000 });
  });
  it('an edit list that disagrees with its track is contradictory', async () => {
    expect(await check(movie(10, [track('vide', 10, { edit: [[4000, 0]] })]))).toMatchObject({ reason: 'unreadable', detail: 'edit list disagrees with the track' });
  });
  it('an edit that plays at another speed is refused', async () => {
    expect(await check(movie(10, [track('vide', 10, { edit: [[10000, 0, 2]] })]))).toMatchObject({ reason: 'unreadable', detail: 'edit plays at another speed' });
  });
  it('the audio track is held to the movie length too', async () => {
    const b = copy('clip-29.9.mp4');
    const tk = findAll(b, 'tkhd', audioTrak(b).body, audioTrak(b).end)[0];
    b.writeUInt32BE(b.readUInt32BE(tk.body + 20) * 2, tk.body + 20);
    expect(await check(b)).toMatchObject({ reason: 'unreadable', detail: 'a track is longer than the movie' });
  });
});

describe('malformed containers', () => {
  it('a truncated file (cut in half) is refused', async () => {
    const b = file('clip-30.0.mp4');
    expect(await check(b.subarray(0, Math.floor(b.length / 2)))).toMatchObject({ ok: false, reason: 'unreadable' });
  });
  it('a box claiming to run past the end of the file is refused', async () => {
    const b = copy('clip-30.0.mp4');
    b.writeUInt32BE(b.length * 4, findAll(b, 'mdat')[0].start);
    expect(await check(b)).toMatchObject({ reason: 'unreadable' });
  });
  it('a box smaller than its own header is refused', async () => {
    const b = copy('clip-30.0.mov');
    b.writeUInt32BE(4, findAll(b, 'trak')[0].start);
    expect(await check(b)).toMatchObject({ reason: 'unreadable' });
  });
  it('two movie boxes are refused', async () => {
    const f = Buffer.concat([ftyp(), box('moov', mvhd(1000, 5000), track('vide', 5)), box('moov', mvhd(1000, 50000), track('vide', 50))]);
    expect(await check(f)).toMatchObject({ reason: 'unreadable', detail: 'more than one moov' });
  });
  it('no movie box is refused', async () => {
    expect(await check(Buffer.concat([ftyp(), box('mdat', Buffer.alloc(64))]))).toMatchObject({ reason: 'unreadable', detail: 'no moov' });
  });
  it('a duplicate header inside a track is refused', async () => {
    const t = box('trak', tkhd(5000), tkhd(5000), box('mdia', mdhd(1000, 5000), hdlr('vide'), box('minf', box('stbl', stts([[50, 100]])))));
    expect(await check(movie(5, [t]))).toMatchObject({ reason: 'unreadable', detail: 'two tkhd' });
  });
  it('trailing garbage after the last box is refused', async () => {
    expect(await check(Buffer.concat([movie(5, [track('vide', 5)]), Buffer.from([1, 2, 3])]))).toMatchObject({ reason: 'unreadable' });
  });
  it('random bytes are refused, never guessed', async () => {
    const r = Buffer.alloc(4096);
    for (let i = 0; i < r.length; i++) r[i] = (i * 2654435761) & 255;
    expect((await check(r)).ok).toBe(false);
  });
  it('an empty or unknown-size file is refused without reading it', async () => {
    const r = memReader(Buffer.alloc(0));
    expect(await checkVideoDuration(r)).toMatchObject({ reason: 'unreadable' });
    expect(r.stats.reads).toBe(0);
    expect(await checkVideoDuration({ size: undefined, read: async () => { throw new Error('should not read'); } })).toMatchObject({ reason: 'unreadable' });
  });
});

describe('parser resource limits', () => {
  it('the limits are strict', () => {
    expect(LIMITS).toMatchObject({ maxFileBytes: 25 * 1024 * 1024, maxBytesRead: 4 * 1024 * 1024, maxMoovBytes: 2 * 1024 * 1024, maxDepth: 8, maxTracks: 16, maxSttsEntries: 20000, maxElstEntries: 64 });
    expect(LIMITS.maxMillis).toBeLessThanOrEqual(2000);
  });
  it('a file over 25 MB is refused without reading it', async () => {
    const r = memReader(Buffer.alloc(16), 26 * 1024 * 1024);
    expect(await checkVideoDuration(r)).toMatchObject({ reason: 'unreadable', detail: 'file too large' });
    expect(r.stats.reads).toBe(0);
  });
  it('an oversized timing table is refused', async () => {
    const big = Array.from({ length: LIMITS.maxSttsEntries + 1 }, () => [1, 1]);
    expect(await check(movie(1, [track('vide', 1, { sttsEntries: big })]))).toMatchObject({ reason: 'unreadable', detail: 'stts too large' });
  });
  it('a timing table whose count runs past its box is refused', async () => {
    const t = box('trak', tkhd(5000), box('mdia', mdhd(1000, 5000), hdlr('vide'), box('minf', box('stbl', box('stts', u32(0, 1000), u32(50, 100))))));
    expect(await check(movie(5, [t]))).toMatchObject({ reason: 'unreadable', detail: 'stts shorter than its count' });
  });
  it('an oversized edit list is refused', async () => {
    const many = Array.from({ length: LIMITS.maxElstEntries + 1 }, () => [10, 0]);
    expect(await check(movie(1, [track('vide', 1, { edit: many })]))).toMatchObject({ reason: 'unreadable', detail: 'elst too large' });
  });
  it('nesting deeper than the limit is refused', async () => {
    expect(await check(movie(5, [track('vide', 5, { wrapDepth: 10 })]))).toMatchObject({ reason: 'unreadable', detail: 'nested too deep' });
  });
  it('too many tracks are refused', async () => {
    const tracks = [track('vide', 5), ...Array.from({ length: LIMITS.maxTracks }, () => track('soun', 5))];
    expect(await check(movie(5, tracks))).toMatchObject({ reason: 'unreadable', detail: 'too many tracks' });
  });
  it('too many boxes are refused', async () => {
    const filler = Array.from({ length: 50 }, () => box('free'));
    expect(await check(movie(5, [track('vide', 5), ...filler]), { limits: { maxBoxes: 40 } })).toMatchObject({ reason: 'unreadable', detail: 'too many boxes' });
  });
  it('too many top-level boxes are refused', async () => {
    const f = Buffer.concat([ftyp(), ...Array.from({ length: LIMITS.maxTopLevelBoxes + 1 }, () => box('free')), box('moov', mvhd(1000, 5000), track('vide', 5))]);
    expect(await check(f)).toMatchObject({ reason: 'unreadable', detail: 'too many top-level boxes' });
  });
  it('a movie box over its size limit is refused before it is read', async () => {
    const r = memReader(file('clip-30.0.mp4'));
    expect(await checkVideoDuration(r, { limits: { maxMoovBytes: 64 } })).toMatchObject({ reason: 'unreadable', detail: 'moov too large' });
    expect(r.stats.bytes).toBeLessThan(2048);
  });
  it('the total bytes read are capped', async () => {
    expect(await check(file('clip-30.0.mp4'), { limits: { maxBytesRead: 100 } })).toMatchObject({ reason: 'unreadable', detail: 'read limit' });
  });
  it('the check stops when it runs out of time', async () => {
    let t = 0;
    expect(await check(file('clip-30.0.mp4'), { now: () => (t += 1000) })).toMatchObject({ reason: 'unreadable', detail: 'took too long' });
  });
  it('a huge declared mdat is skipped, not read', async () => {
    const head = Buffer.concat([ftyp(), box('moov', mvhd(1000, 5000), track('vide', 5))]);
    const mdatHead = Buffer.alloc(8);
    const size = 20 * 1024 * 1024;
    mdatHead.writeUInt32BE(size - head.length, 0);
    mdatHead.write('mdat', 4, 'latin1');
    const r = memReader(Buffer.concat([head, mdatHead]), size);
    expect(await checkVideoDuration(r)).toEqual({ ok: true, durationMs: 5000 });
    expect(r.stats.bytes).toBeLessThan(head.length + 64);
  });
});

describe('a storage failure is never a verdict', () => {
  it('a reader that throws makes the check throw (the caller retries)', async () => {
    await expect(checkVideoDuration({ size: 1000, read: async () => { throw new Error('storage down'); } })).rejects.toThrow('storage down');
  });
  it('a short read is a failure, not a file problem', async () => {
    await expect(checkVideoDuration({ size: 1000, read: async () => new Uint8Array(3) })).rejects.toThrow();
  });
  it('the range reader requires an exact 206 answer for the same file size', async () => {
    const buf = file('clip-29.9.mp4');
    const ok = async (url, { headers }) => {
      const [a, b] = headers.Range.replace('bytes=', '').split('-').map(Number);
      return { status: 206, headers: { get: () => `bytes ${a}-${b}/${buf.length}` }, arrayBuffer: async () => buf.subarray(a, b + 1) };
    };
    expect(await checkVideoDuration(rangeReader('u', buf.length, ok))).toEqual({ ok: true, durationMs: 29900 });
    const whole = async () => ({ status: 200, headers: { get: () => null }, arrayBuffer: async () => buf });
    await expect(checkVideoDuration(rangeReader('u', buf.length, whole))).rejects.toThrow('answered 200');
    const changed = async (url, opts) => { const r = await ok(url, opts); return { ...r, headers: { get: () => 'bytes 0-15/999' } }; };
    await expect(checkVideoDuration(rangeReader('u', buf.length, changed))).rejects.toThrow('size changed');
  });
});

// ---- the shared screening step: length first, then content screening ----
function deps(buf, { classify = 'low', record = true, listThrows = false, sizeOverride } = {}) {
  const calls = { classify: 0, record: [] };
  return {
    calls,
    d: {
      storage: {
        list: async () => { if (listThrows) throw new Error('down'); return { size: sizeOverride ?? buf.length }; },
        signedUrl: async (p) => `https://storage/${p}`,
      },
      fetchFn: async (url, { headers }) => {
        const [a, b] = headers.Range.replace('bytes=', '').split('-').map(Number);
        return { status: 206, headers: { get: () => `bytes ${a}-${b}/${buf.length}` }, arrayBuffer: async () => buf.subarray(a, b + 1) };
      },
      classifyImage: async () => {
        calls.classify += 1;
        if (classify === 'service') return { error: 'down', service: true };
        return { riskTier: classify, matchedCategories: [], reasoning: 'ok' };
      },
      worseTier: (a, b) => (['low', 'medium', 'uncertain', 'high'].indexOf(b) > ['low', 'medium', 'uncertain', 'high'].indexOf(a) ? b : a),
      recordVideoCheck: async (p, m, ms) => { calls.record.push([p, m, ms]); return record; },
    },
  };
}
const P = 'partner-1';
const run = (buf, opts, mediaPath = `${P}/v.mp4`) => {
  const { d, calls } = deps(buf, opts);
  return screenOfferMedia(d, P, mediaPath, 'video', [`${P}/f1.jpg`]).then((res) => ({ res, calls }));
};

describe('screenOfferMedia: failed validation prevents screening and customer access', () => {
  it('a 30.1 s video is refused with the localized-source message and is never classified or recorded', async () => {
    const { res, calls } = await run(file('clip-30.1.mov'));
    expect(res).toEqual({ status: 400, error: VIDEO_CHECK_MESSAGES.too_long, code: 'video_too_long' });
    expect(calls.classify).toBe(0);
    expect(calls.record).toEqual([]);
  });
  it('an unreadable or contradictory video is refused with "We couldn\'t check this video\'s length."', async () => {
    const b = copy('clip-30.0.mp4');
    b.writeUInt32BE(0, findAll(b, 'mvhd')[0].body + 16);
    const { res, calls } = await run(b);
    expect(res).toMatchObject({ status: 400, error: "We couldn't check this video's length.", code: 'video_length_unchecked' });
    expect(calls.classify).toBe(0);
    expect(calls.record).toEqual([]);
  });
  it('another format is refused as unsupported and never classified', async () => {
    const { res, calls } = await run(file('clip-10.webm'));
    expect(res).toMatchObject({ status: 400, code: 'video_format_unsupported' });
    expect(calls.classify).toBe(0);
  });
  it('a 30.0 s video is recorded, then its frames are screened', async () => {
    const { res, calls } = await run(file('clip-30.0.mp4'));
    expect(calls.record).toEqual([[P, `${P}/v.mp4`, 30000]]);
    expect(calls.classify).toBe(1);
    expect(res).toMatchObject({ tier: 'low', posterPath: `${P}/f1.jpg` });
  });
  it('a listed size over 25 MB is refused before any read', async () => {
    const { res, calls } = await run(file('clip-29.9.mp4'), { sizeOverride: 26 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect(calls.classify).toBe(0);
  });
  it('a screening-provider outage leaves it pending (503), never approved', async () => {
    const { res } = await run(file('clip-29.9.mp4'), { classify: 'service' });
    expect(res).toEqual({ status: 503, service: true });
  });
  it('a storage outage is a retry, not a verdict about the file', async () => {
    const { res, calls } = await run(file('clip-29.9.mp4'), { listThrows: true });
    expect(res).toEqual({ status: 503, service: true });
    expect(calls.classify).toBe(0);
  });
  it('if the passing check cannot be recorded, nothing is screened (the database would refuse it anyway)', async () => {
    const { res, calls } = await run(file('clip-29.9.mp4'), { record: false });
    expect(res).toEqual({ status: 503, service: true });
    expect(calls.classify).toBe(0);
  });
  it('a direct call naming another business\'s file or no frames is refused before anything is read', async () => {
    expect((await run(file('clip-29.9.mp4'), {}, 'other/v.mp4')).res.status).toBe(400);
    const { d, calls } = deps(file('clip-29.9.mp4'));
    expect((await screenOfferMedia(d, P, `${P}/v.mp4`, 'video', [])).status).toBe(400);
    expect(calls.classify).toBe(0);
  });
  it('images skip the length check and are screened as before', async () => {
    const { d, calls } = deps(Buffer.alloc(0));
    const res = await screenOfferMedia(d, P, `${P}/a.jpg`, 'image', []);
    expect(res).toMatchObject({ tier: 'low', posterPath: null });
    expect(calls.record).toEqual([]);
  });
});

describe('the edge function and the database use this gate', () => {
  const edge = fs.readFileSync(path.join(__dirname, '../../supabase/functions/screen-business-content/index.ts'), 'utf8');
  const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270289_server_video_length_gate.sql'), 'utf8');
  it('screen-business-content screens media only through the shared step and records passing checks', () => {
    expect(edge).toMatch(/from '\.\.\/_shared\/offerMediaScreening\.js'/);
    expect(edge).toMatch(/business_video_checks/);
    expect(edge).not.toMatch(/async function screenOfferMedia/);
  });
  it('the database refuses unchecked videos on ready creatives and offers, and admins get no blanket bypass', () => {
    expect(mig).toMatch(/creative_video_must_be_checked/);
    expect(mig).toMatch(/offer_video_must_be_cleared/);
    expect(mig).toMatch(/duration_ms <= 30000/);
    expect(mig).not.toMatch(/check_is_admin\(auth\.uid\(\)\), false\) then\s*raise exception 'That video/);
  });
});

describe('the app shows these refusals in the person\'s language', () => {
  const { SERVER_VIDEO_MESSAGES, videoProblemText } = require('./videoProblem');
  const { serviceError } = require('./recoverableError');
  const { needsChangesReason } = require('./creativeLibrary');
  const { needsChangesExplanation } = require('./offerSubmission');
  const bizHelp = require('../../scripts/i18n/strings/bizHelp.json');
  it('the app\'s English copy is exactly what the server says', () => {
    expect(SERVER_VIDEO_MESSAGES.video_too_long).toBe(VIDEO_CHECK_MESSAGES.too_long);
    expect(SERVER_VIDEO_MESSAGES.video_length_unchecked).toBe(VIDEO_CHECK_MESSAGES.unreadable);
    expect(SERVER_VIDEO_MESSAGES.video_format_unsupported).toBe(VIDEO_CHECK_MESSAGES.unsupported);
    expect(bizHelp.en['offerForm.videoTooLong']).toBe(VIDEO_CHECK_MESSAGES.too_long);
    expect(bizHelp.en['offerForm.videoLengthUnchecked']).toBe(VIDEO_CHECK_MESSAGES.unreadable);
    expect(bizHelp.en['offerForm.videoFormatUnsupported']).toBe(VIDEO_CHECK_MESSAGES.unsupported);
  });
  it('every language has both new messages', () => {
    for (const lang of Object.keys(bizHelp)) {
      expect(bizHelp[lang]['offerForm.videoLengthUnchecked']).toBeTruthy();
      expect(bizHelp[lang]['offerForm.videoFormatUnsupported']).toBeTruthy();
    }
  });
  it('direct replies (by code), library items and background submissions (by stored text) read back to the same words', () => {
    expect(serviceError({ status: 400 }, { error: 'x', code: 'video_length_unchecked' }, 'f').message).toBe(videoProblemText('video_length_unchecked'));
    expect(needsChangesReason({ status: 'needs_changes', problem: VIDEO_CHECK_MESSAGES.unreadable })).toBe(videoProblemText('video_length_unchecked'));
    expect(needsChangesExplanation({ status: 'needs_changes', reason: VIDEO_CHECK_MESSAGES.too_long })).toContain(videoProblemText('video_too_long'));
    expect(videoProblemText('Some other reason.')).toBe('Some other reason.');
  });
});
