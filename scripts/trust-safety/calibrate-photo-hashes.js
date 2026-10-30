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
};
// edits we do NOT claim to catch (reported, never used to choose thresholds)
const NOT_CLAIMED = new Set(['crop_30', 'crop_20_offcentre', 'border_10', 'rotate_5', 'rotate_90']);
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
  for (const file of originals) {
    let base;
    try { base = await Jimp.read(file); } catch { continue; }
    const raw = hashOf(base); // the file as decoded, no re-save (for the Deno parity check)
    const hashes = hashOf(await asUpload(base.clone()));
    if (!hashes.full) continue;
    const copies = {};
    for (const [edit, fn] of Object.entries(EDITS)) {
      const h = hashOf(await asUpload(fn(base.clone())));
      if (h.full) copies[edit] = h;
    }
    items.push({ id: path.relative(process.cwd(), file), set: path.basename(path.dirname(file)), raw, hashes, copies });
  }
  if (hashesOut) fs.writeFileSync(hashesOut, JSON.stringify(items.map((i) => ({ id: i.id, raw: i.raw }))));

  // the smallest (d, p) pair over the allowed pairings, kept as every pairing's pair (a match needs both on ONE pairing)
  const pairings = (a, b) => {
    const out = [];
    for (const v of Object.keys(b)) out.push([a.full, b[v]]);
    for (const v of Object.keys(a)) if (v !== 'full') out.push([a[v], b.full]);
    return out.map(([x, y]) => [hashDistance(x.dhash, y.dhash), hashDistance(x.phash, y.phash)]);
  };
  const matches = (pairs, D, P) => pairs.some(([d, p]) => d <= D && p <= P);

  const positives = []; // { edit, pairs }
  for (const it of items) for (const [edit, h] of Object.entries(it.copies)) positives.push({ edit, pairs: pairings(h, it.hashes) });
  const negatives = [];
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
    negatives.push({ a: items[i].id, b: items[j].id, kind: [items[i].set, items[j].set].sort().join('+'), pairs: pairings(items[i].hashes, items[j].hashes) });
  }

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
  const minNeg = negatives.reduce((m, n) => Math.min(m, ...n.pairs.map(([d, p]) => Math.max(d, p))), 64);

  const summary = { photos: items.length, duplicateFilesDropped: duplicateFiles, copies: positives.length, differentPairs: negatives.length,
    closestDifferentPair: minNeg, recommended: pick, grid };
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 1));
  const pct = (x) => (x == null ? '  -  ' : `${(100 * x).toFixed(1).padStart(5)}%`);
  console.log(`byte-identical test files dropped: ${duplicateFiles}`);
  console.log(`photos ${items.length}, edited copies ${positives.length}, pairs of different photos ${negatives.length}`);
  console.log(`closest pair of DIFFERENT photos (max of the two distances, best pairing): ${minNeg}`);
  const show = (g) => console.log(`D<=${String(g.D).padStart(2)} P<=${String(g.P).padStart(2)}  false matches ${String(g.falseMatches).padStart(4)} ${JSON.stringify(g.fpByKind)}  claimed recall ${pct(g.claimedRecall)}  | `
    + Object.entries(g.byEdit).map(([e, r]) => `${e} ${pct(r)}`).join('  '));
  for (const g of grid.filter((x) => (x.D === x.P && x.D % 2 === 0) || x === pick)) show(g);
  console.log('\nzero false matches, best five:');
  zero.slice(0, 5).forEach(show);
  console.log(pick ? `\nrecommended (0 false matches, best recall): D<=${pick.D} P<=${pick.P}` : '\nno threshold pair has 0 false matches');
})().catch((e) => { console.error(e); process.exit(1); });
