#!/usr/bin/env node
// Calibration for near-duplicate photo detection (20270368; owner 2026-10-30: measure false matches AND missed matches
// before anything is switched on). Runs LOCALLY on a folder of test photos; nothing is uploaded or sent anywhere.
//
//   node scripts/trust-safety/calibrate-photo-hashes.js <photo dir> [<photo dir> ...] [--json out.json] [--hashes out.json]
//
// For every original it makes edited copies the way a person reposting a photo would (resize, re-save, filters, mirror,
// trims of 10/20/30%, an off-centre trim, a border, small and quarter-turn rotations), re-encodes each as JPEG like an
// upload, and hashes everything with the SAME module moderate-photo uses (supabase/functions/_shared/perceptualHash.js).
// Copies of the same original = should match; every pair of DIFFERENT originals = must not. A pair matches under
// thresholds (D, P) when, for one allowed variant pairing (the new photo's whole image against any variant of the other,
// or any variant of the new photo against the other's whole image: the rule the database applies), dHash distance <= D
// AND pHash distance <= P. Reports, per threshold pair: false matches among different photos and the share of copies
// caught for each kind of edit. Uses jimp-compact (already installed with Expo) to decode, edit and re-encode.
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp-compact');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const jsonOut = flag('--json');
const hashesOut = flag('--hashes');
// --cache <dir>: one result file per photo, so a run that is killed (e.g. a codespace restart) resumes where it stopped.
// --shard i/n + --hash-only: fill the cache in n parallel processes; then one run without them compares everything.
const cacheDir = flag('--cache');
const shardArg = flag('--shard');
const hashOnly = args.includes('--hash-only') ? (args.splice(args.indexOf('--hash-only'), 1), true) : false;
const [shardI, shardN] = shardArg ? shardArg.split('/').map(Number) : [0, 1];
if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
const cacheFileOf = (file) => cacheDir && path.join(cacheDir, `${require('crypto').createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 24)}.json`);
const dirs = args;
if (!dirs.length) { console.error('usage: calibrate-photo-hashes.js <photo dir> ...'); process.exit(2); }

const EDITS = {
  resize_50: (im) => im.scale(0.5),
  resize_25: (im) => im.scale(0.25),
  jpeg_q30: (im) => im.quality(30),
  brighter: (im) => im.brightness(0.15),
  contrast: (im) => im.contrast(0.25),
  blur: (im) => im.blur(2),
  greyscale: (im) => im.greyscale(),
  mirror: (im) => im.flip(true, false),
  crop_10: (im) => trim(im, 0.10),
  crop_20: (im) => trim(im, 0.20),
  crop_30: (im) => trim(im, 0.30),
  crop_20_offcentre: (im) => im.crop(0, 0, Math.round(im.bitmap.width * 0.8), Math.round(im.bitmap.height * 0.8)),
  mirror_crop_20: (im) => trim(im.flip(true, false), 0.20),
  border_10: (im) => { const w = im.bitmap.width; const h = im.bitmap.height; const pad = Math.round(Math.max(w, h) * 0.1);
    return new Jimp(w + 2 * pad, h + 2 * pad, 0xffffffff).composite(im, pad, pad); },
  rotate_5: (im) => im.rotate(5, false),
  rotate_90: (im) => im.rotate(90),
  // added 2026-11-01 (larger calibration): heavier compression, small off-centre trims, screenshots
  jpeg_q10: (im) => im.quality(10),
  resave_twice: async (im) => (await Jimp.read(await im.quality(60).getBufferAsync(Jimp.MIME_JPEG))).quality(50),
  thumbnail_upscaled: (im) => { const w = im.bitmap.width; const h = im.bitmap.height; return im.resize(Math.round(w / 4), Math.round(h / 4)).resize(w, h); },
  crop_5_offcentre: (im) => im.crop(0, 0, Math.round(im.bitmap.width * 0.95), Math.round(im.bitmap.height * 0.95)),
  crop_10_offcentre: (im) => im.crop(0, 0, Math.round(im.bitmap.width * 0.9), Math.round(im.bitmap.height * 0.9)),
  screenshot: (im) => screenshot(im),
  screenshot_cropped: (im) => { const s = screenshot(im); const { top, h } = s._photoBox; const slack = Math.round(h * 0.03);
    return s.crop(0, Math.max(0, top - slack), s.bitmap.width, Math.min(s.bitmap.height - Math.max(0, top - slack), h + 2 * slack)); },
};
// edits we do NOT claim to catch (reported, never used to choose thresholds). The 2026-11-01 additions are all reported
// separately and never claimed, so the "claimed" column stays comparable with the 2026-10-30 run.
const NOT_CLAIMED = new Set(['crop_30', 'crop_20_offcentre', 'border_10', 'rotate_5', 'rotate_90',
  'jpeg_q10', 'resave_twice', 'thumbnail_upscaled', 'crop_5_offcentre', 'crop_10_offcentre', 'screenshot', 'screenshot_cropped']);
// A phone screenshot of the photo shown full width in an app: status bar + app bar above, a white action area below
// (grey buttons), then scaled down like a shared screenshot.
function screenshot(im) {
  const w = im.bitmap.width; const h = im.bitmap.height;
  const status = Math.round(w * 0.1); const bar = Math.round(w * 0.16); const below = Math.round(w * 0.45);
  const canvas = new Jimp(w, status + bar + h + below, 0xffffffff);
  canvas.scan(0, 0, w, status, function (x, y, i) { this.bitmap.data[i] = 20; this.bitmap.data[i + 1] = 20; this.bitmap.data[i + 2] = 20; });
  canvas.scan(Math.round(w * 0.06), status + Math.round(bar * 0.35), Math.round(w * 0.5), Math.round(bar * 0.3), function (x, y, i) { this.bitmap.data[i] = 60; this.bitmap.data[i + 1] = 60; this.bitmap.data[i + 2] = 60; });
  canvas.composite(im, 0, status + bar);
  for (let b = 0; b < 3; b += 1) canvas.scan(Math.round(w * (0.06 + b * 0.31)), status + bar + h + Math.round(below * 0.3), Math.round(w * 0.26), Math.round(below * 0.25), function (x, y, i) { this.bitmap.data[i] = 200; this.bitmap.data[i + 1] = 200; this.bitmap.data[i + 2] = 205; });
  const scale = 0.6;
  canvas.scale(scale);
  canvas._photoBox = { top: Math.round((status + bar) * scale), h: Math.round(h * scale) };
  return canvas;
}
// pairs are labelled by the folders the two photos came from; constructed groups (shared-bg/bgN-*, same-face/faceN-*)
// and owner-supplied group folders are reported as "within group" so the hard cases can be read on their own
function groupOf(file) {
  const base = path.basename(file); const set = path.basename(path.dirname(file));
  const m = /^(bg\d+|face\d+)-/.exec(base);
  return m ? `${set}/${m[1]}` : set;
}
function kindOf(a, b) {
  if (a.group === b.group && a.group !== a.set) return `${a.set}:within-group`;
  return [a.set, b.set].sort().join('+');
}
function trim(im, fraction) {
  const w = im.bitmap.width; const h = im.bitmap.height;
  const kw = Math.round(w * (1 - fraction)); const kh = Math.round(h * (1 - fraction));
  return im.crop(Math.round((w - kw) / 2), Math.round((h - kh) / 2), kw, kh);
}

(async () => {
  const { perceptualHashes, hashDistance } = await import('../../supabase/functions/_shared/perceptualHash.js');
  const asUpload = async (im) => Jimp.read(await im.quality(Math.min(im._quality || 85, 85)).getBufferAsync(Jimp.MIME_JPEG));
  const hashOf = (im) => Object.fromEntries(perceptualHashes(im.bitmap).map((h) => [h.variant, h]));

  // byte-identical files in the test set are TRUE copies, never "different photos": keep one of each (reported)
  const originals = [];
  const seen = new Set();
  let duplicateFiles = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => /\.jpe?g$/i.test(x)).sort()) {
      const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
      if (seen.has(sha)) { duplicateFiles += 1; continue; }
      seen.add(sha);
      originals.push(path.join(dir, f));
    }
  }
  const items = []; // { id, file, hashes, copies: { edit: hashes } }
  for (const [n, file] of originals.entries()) {
    const cacheFile = cacheFileOf(file);
    if (cacheFile && fs.existsSync(cacheFile)) {
      if (!hashOnly) { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c) items.push(c); }
      continue;
    }
    if (n % shardN !== shardI) continue;
    let base;
    try { base = await Jimp.read(file); } catch { if (cacheFile) fs.writeFileSync(cacheFile, 'null'); continue; }
    const raw = hashOf(base); // the file as decoded, no re-save (for the Deno parity check)
    const hashes = hashOf(await asUpload(base.clone()));
    if (!hashes.full) { if (cacheFile) fs.writeFileSync(cacheFile, 'null'); continue; }
    const copies = {};
    for (const [edit, fn] of Object.entries(EDITS)) {
      const h = hashOf(await asUpload(await fn(base.clone())));
      if (h.full) copies[edit] = h;
    }
    const item = { id: path.relative(process.cwd(), file), set: path.basename(path.dirname(file)), group: groupOf(file), raw, hashes, copies };
    if (cacheFile) { fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(item)); fs.renameSync(`${cacheFile}.tmp`, cacheFile); }
    if (!hashOnly) items.push(item);
  }
  if (hashOnly) { console.log(`shard ${shardI}/${shardN} hashed`); return; }
  if (cacheDir && shardN === 1) {
    const done = originals.filter((f) => fs.existsSync(cacheFileOf(f))).length;
    if (done !== originals.length) { console.error(`cache incomplete: ${done}/${originals.length}`); process.exit(3); }
  }
  if (hashesOut) fs.writeFileSync(hashesOut, JSON.stringify(items.map((i) => ({ id: i.id, raw: i.raw }))));

  // Fast distance: each 64-bit hash as two 32-bit halves (same Hamming distance as hashDistance; checked below).
  const split = (v) => { const x = BigInt.asUintN(64, BigInt(v)); return [Number(x >> 32n) >>> 0, Number(x & 0xffffffffn) >>> 0]; };
  const pop = (n) => { n -= (n >>> 1) & 0x55555555; n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const fast = (h) => { const [dh, dl] = split(h.dhash); const [ph, pl] = split(h.phash); return { dh, dl, ph, pl, dhash: h.dhash, phash: h.phash }; };
  for (const it of items) { for (const k of Object.keys(it.hashes)) it.hashes[k] = fast(it.hashes[k]);
    for (const e of Object.keys(it.copies)) for (const k of Object.keys(it.copies[e])) it.copies[e][k] = fast(it.copies[e][k]); }
  const dist = (x, y) => [pop(x.dh ^ y.dh) + pop(x.dl ^ y.dl), pop(x.ph ^ y.ph) + pop(x.pl ^ y.pl)];
  { const a = items[0].hashes.full; const b = items[1].hashes.full; const [d, p] = dist(a, b);
    if (d !== hashDistance(a.dhash, b.dhash) || p !== hashDistance(a.phash, b.phash)) throw new Error('fast distance disagrees with hashDistance'); }

  // the smallest (d, p) pair over the allowed pairings, kept as every pairing's pair (a match needs both on ONE pairing)
  const pairings = (a, b) => {
    const out = [];
    for (const v of Object.keys(b)) out.push([a.full, b[v]]);
    for (const v of Object.keys(a)) if (v !== 'full') out.push([a[v], b.full]);
    return out.map(([x, y]) => dist(x, y));
  };
  const matches = (pairs, D, P) => pairs.some(([d, p]) => d <= D && p <= P);

  const positives = []; // { edit, pairs }
  for (const it of items) for (const [edit, h] of Object.entries(it.copies)) positives.push({ edit, pairs: pairings(h, it.hashes) });
  // Pairs of different photos. Only pairs that could match anywhere in the grid (some pairing with both distances <= 20)
  // are kept in full; for every pair the closest distance is counted (the margin histogram).
  const negatives = [];
  const closestHistogram = new Array(65).fill(0);
  const closestByKind = {};
  let differentPairs = 0;
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
    const pairs = pairings(items[i].hashes, items[j].hashes);
    const closest = pairs.reduce((m, [d, p]) => Math.min(m, Math.max(d, p)), 64);
    const kind = kindOf(items[i], items[j]);
    differentPairs += 1;
    closestHistogram[closest] += 1;
    closestByKind[kind] = Math.min(closestByKind[kind] ?? 64, closest);
    if (closest <= 20) negatives.push({ a: items[i].id, b: items[j].id, kind, closest, pairs: pairs.filter(([d, p]) => d <= 20 && p <= 20) });
  }
  const pairsByKind = {};
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) { const k = kindOf(items[i], items[j]); pairsByKind[k] = (pairsByKind[k] || 0) + 1; }

  const grid = [];
  for (let D = 4; D <= 20; D += 1) for (let P = 4; P <= 20; P += 1) {
    const fp = negatives.filter((n) => matches(n.pairs, D, P));
    const fpByKind = {};
    for (const n of fp) fpByKind[n.kind] = (fpByKind[n.kind] || 0) + 1;
    const byEdit = {};
    for (const e of Object.keys(EDITS)) {
      const ps = positives.filter((p) => p.edit === e);
      byEdit[e] = ps.length ? ps.filter((p) => matches(p.pairs, D, P)).length / ps.length : null;
    }
    const claimed = positives.filter((p) => !NOT_CLAIMED.has(p.edit));
    grid.push({ D, P, falseMatches: fp.length, fpByKind, falseExamples: fp.slice(0, 3).map((n) => [n.a, n.b]),
      claimedRecall: claimed.filter((p) => matches(p.pairs, D, P)).length / claimed.length, byEdit });
  }
  // recommended: the best claimed recall with ZERO false matches, ties -> the tighter thresholds
  const zero = grid.filter((g) => g.falseMatches === 0).sort((a, b) => b.claimedRecall - a.claimedRecall || (a.D + a.P) - (b.D + b.P));
  const pick = zero[0] || null;
  const minNeg = closestHistogram.findIndex((n) => n > 0);
  const nearest = negatives.slice().sort((a, b) => a.closest - b.closest).slice(0, 15).map((n) => ({ closest: n.closest, kind: n.kind, a: n.a, b: n.b }));
  const cumulative = {};
  for (const t of [8, 10, 11, 12, 13, 14, 16, 18, 20]) cumulative[t] = closestHistogram.slice(0, t + 1).reduce((x, y) => x + y, 0);

  const summary = { photos: items.length, duplicateFilesDropped: duplicateFiles, copies: positives.length, differentPairs,
    closestDifferentPair: minNeg, closestByKind, pairsByKind, pairsWithClosestAtOrBelow: cumulative, nearest, recommended: pick, grid };
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 1));
  const pct = (x) => (x == null ? '  -  ' : `${(100 * x).toFixed(1).padStart(5)}%`);
  console.log(`byte-identical test files dropped: ${duplicateFiles}`);
  console.log(`photos ${items.length}, edited copies ${positives.length}, pairs of different photos ${differentPairs}`);
  console.log(`closest pair of DIFFERENT photos (max of the two distances, best pairing): ${minNeg}`);
  console.log(`pairs of different photos whose closest pairing is <= t: ${JSON.stringify(cumulative)}`);
  console.log(`closest by kind: ${JSON.stringify(closestByKind)}`);
  console.log(`pairs by kind: ${JSON.stringify(pairsByKind)}`);
  console.log('nearest different pairs:'); nearest.forEach((n) => console.log(`  ${n.closest}  ${n.kind}  ${n.a}  ${n.b}`));
  const show = (g) => console.log(`D<=${String(g.D).padStart(2)} P<=${String(g.P).padStart(2)}  false matches ${String(g.falseMatches).padStart(4)} ${JSON.stringify(g.fpByKind)}  claimed recall ${pct(g.claimedRecall)}  | `
    + Object.entries(g.byEdit).map(([e, r]) => `${e} ${pct(r)}`).join('  '));
  for (const g of grid.filter((x) => (x.D === x.P && x.D % 2 === 0) || x === pick)) show(g);
  const approved = grid.find((g) => g.D === 10 && g.P === 10);
  console.log('\nAPPROVED 10/10 (owner 2026-10-30):'); show(approved);
  console.log(`  false-match examples: ${JSON.stringify(approved.falseExamples)}`);
  console.log('\nzero false matches, best five:');
  zero.slice(0, 5).forEach(show);
  console.log(pick ? `\nrecommended (0 false matches, best recall): D<=${pick.D} P<=${pick.P}` : '\nno threshold pair has 0 false matches');
})().catch((e) => { console.error(e); process.exit(1); });
