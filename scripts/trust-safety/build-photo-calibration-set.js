#!/usr/bin/env node
// Builds the larger photo-calibration set for near-duplicate detection (owner 2026-11-01: a larger, more representative
// set from appropriately authorized images; measure false matches AND missed duplicates at the approved 10/10; never
// change the threshold from it). LOCAL ONLY: downloads into <out dir>, nothing is uploaded, nothing is committed.
//
//   node scripts/trust-safety/build-photo-calibration-set.js <out dir>
//
// Sources (each file's source, author and licence are written to <out dir>/manifest.json):
//   general/    every photo in the Lorem Picsum catalogue (Unsplash photos, Unsplash License: free to use, no
//               permission needed), 600x800 like a profile photo.
//   portraits/  randomuser.me portraits (the same source the 2026-10-30 run used), men + women 0-99: the hard case
//               (same pose, same framing, same plain background).
// Constructed from those two (no new people):
//   shared-bg/  "reused background": 40 general photos, each with 4 DIFFERENT portraits placed in the same spot. Photos
//               of different people in the same place must not match.
//   same-face/  "same face, different photo" (the closest authorized stand-in for family members / look-alikes): each of
//               40 portraits placed on 3 different backgrounds. Different photos of one face must not match either:
//               detection is about the same PHOTO reused, never the same person.
// NOT available from any source we're authorized to use, so NOT in this set: real family members, real look-alikes, real
// selfies / group photos / dating-profile photos. Those need consented photos supplied by the owner: put each group in
// its own folder (e.g. related/family-1/*.jpg) and pass it to calibrate-photo-hashes.js; pairs within a folder are
// reported as their own kind.
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp-compact');

const out = process.argv[2];
if (!out) { console.error('usage: build-photo-calibration-set.js <out dir>'); process.exit(2); }
const sub = (n) => { const d = path.join(out, n); fs.mkdirSync(d, { recursive: true }); return d; };
const manifest = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return true; }
      if (res.status === 404) return false;
    } catch { /* retry */ }
    await sleep(500 * (attempt + 1));
  }
  return false;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i; i += 1; await fn(items[k]); } }));
}

(async () => {
  // general: the whole Picsum catalogue
  const list = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=100`);
    const rows = await res.json();
    if (!rows.length) break;
    list.push(...rows);
  }
  const gdir = sub('general');
  await pool(list, 8, async (p) => {
    const file = path.join(gdir, `picsum-${p.id}.jpg`);
    if (await fetchTo(`https://picsum.photos/id/${p.id}/600/800.jpg`, file)) {
      manifest.push({ file: path.relative(out, file), source: p.url, author: p.author, licence: 'Unsplash License (via Lorem Picsum)' });
    }
  });

  const pdir = sub('portraits');
  const portraits = [];
  for (const g of ['men', 'women']) for (let k = 0; k < 100; k += 1) portraits.push([g, k]);
  await pool(portraits, 8, async ([g, k]) => {
    const file = path.join(pdir, `${g}-${k}.jpg`);
    if (await fetchTo(`https://randomuser.me/api/portraits/${g}/${k}.jpg`, file)) {
      manifest.push({ file: path.relative(out, file), source: `https://randomuser.me/api/portraits/${g}/${k}.jpg`, licence: 'randomuser.me (as used 2026-10-30)' });
    }
  });

  // constructed hard cases, deterministic (sorted inputs, fixed strides)
  const gen = fs.readdirSync(gdir).filter((f) => f.endsWith('.jpg')).sort();
  const por = fs.readdirSync(pdir).filter((f) => f.endsWith('.jpg')).sort();
  const place = async (bgFile, faceFile, dest) => {
    const bg = await Jimp.read(path.join(gdir, bgFile));
    const face = (await Jimp.read(path.join(pdir, faceFile))).resize(330, 330); // ~55% of the width, like a person in frame
    bg.composite(face, Math.round((600 - 330) / 2), 800 - 330 - 120);
    await bg.quality(90).writeAsync(dest);
    manifest.push({ file: path.relative(out, dest), constructed: true, background: bgFile, face: faceFile });
  };
  const sbg = sub('shared-bg');
  for (let b = 0; b < 40; b += 1) {
    const bgFile = gen[(b * 23) % gen.length];
    for (let f = 0; f < 4; f += 1) await place(bgFile, por[(b * 4 + f) % por.length], path.join(sbg, `bg${b}-face${f}.jpg`));
  }
  const sf = sub('same-face');
  for (let f = 0; f < 40; f += 1) {
    const faceFile = por[(f * 5 + 1) % por.length];
    for (let b = 0; b < 3; b += 1) await place(gen[(f * 17 + b * 101 + 7) % gen.length], faceFile, path.join(sf, `face${f}-bg${b}.jpg`));
  }
  manifest.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const count = (d) => fs.readdirSync(path.join(out, d)).filter((f) => f.endsWith('.jpg')).length;
  console.log(JSON.stringify({ general: count('general'), portraits: count('portraits'), sharedBackground: count('shared-bg'), sameFace: count('same-face') }));
})().catch((e) => { console.error(e); process.exit(1); });
