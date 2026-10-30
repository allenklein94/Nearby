// Near-duplicate photo hashes (20270368): the shared module moderate-photo runs (supabase/functions/_shared/perceptualHash.js).
// Synthetic images here; real photos are measured by scripts/trust-safety/calibrate-photo-hashes.js
// (PRODUCT_AUDIT/PHOTO_SIMILARITY_CALIBRATION_2026-10-30.md).
const fs = require('fs');
const path = require('path');

let ph;
beforeAll(async () => { ph = await import('../../supabase/functions/_shared/perceptualHash.js'); });

// a w x h RGBA image from a brightness function f(x, y) in 0..1 coordinates
function image(w, h, f) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const v = Math.max(0, Math.min(255, Math.round(255 * f(x / w, y / h))));
    const i = (y * w + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
const scene = (x, y) => 0.5 + 0.25 * Math.sin(7 * x + 2 * y) + 0.2 * Math.cos(5 * y - 3 * x * x) + (x > 0.6 && y < 0.4 ? 0.2 : 0);
const other = (x, y) => 0.5 + 0.3 * Math.cos(11 * y) * Math.sin(4 * x + 1) - (y > 0.7 ? 0.25 : 0);
const byVariant = (img) => Object.fromEntries(ph.perceptualHashes(img).map((h) => [h.variant, h]));
const dist = (a, b) => [ph.hashDistance(a.dhash, b.dhash), ph.hashDistance(a.phash, b.phash)];

test('six variants, each two signed 64-bit numbers', () => {
  const h = ph.perceptualHashes(image(120, 160, scene));
  expect(h.map((x) => x.variant)).toEqual(['full', 'mirror', 'crop90', 'crop90_mirror', 'crop80', 'crop80_mirror']);
  for (const x of h) {
    for (const v of [x.dhash, x.phash]) {
      expect(v).toMatch(/^-?\d{1,19}$/);
      expect(BigInt(v) >= -(2n ** 63n) && BigInt(v) < 2n ** 63n).toBe(true);
    }
  }
});

test('resize-stable: the same picture at another size hashes (almost) the same', () => {
  const a = byVariant(image(300, 400, scene));
  const b = byVariant(image(150, 200, scene));
  const [d, p] = dist(a.full, b.full);
  expect(d).toBeLessThanOrEqual(4);
  expect(p).toBeLessThanOrEqual(4);
});

test('a mirrored copy matches the mirror variant; a trimmed copy matches the crop variants', () => {
  const a = byVariant(image(300, 400, scene));
  const m = byVariant(image(300, 400, (x, y) => scene(1 - x, y)));
  const c = byVariant(image(240, 320, (x, y) => scene(0.1 + 0.8 * x, 0.1 + 0.8 * y)));
  const [md, mp] = dist(m.full, a.mirror);
  expect(md).toBeLessThanOrEqual(4);
  expect(mp).toBeLessThanOrEqual(4);
  const [cd, cp] = dist(c.full, a.crop80);
  expect(cd).toBeLessThanOrEqual(6);
  expect(cp).toBeLessThanOrEqual(6);
  const c9 = byVariant(image(270, 360, (x, y) => scene(0.05 + 0.9 * x, 0.05 + 0.9 * y)));
  const [c9d, c9p] = dist(c9.full, a.crop90);
  expect(c9d).toBeLessThanOrEqual(6);
  expect(c9p).toBeLessThanOrEqual(6);
});

test('a different picture is far on both hashes', () => {
  const a = byVariant(image(300, 400, scene));
  const o = byVariant(image(300, 400, other));
  const [d, p] = dist(a.full, o.full);
  expect(d).toBeGreaterThan(15);
  expect(p).toBeGreaterThan(15);
});

test('a flat or tiny image gets no hash (it would match every other flat image)', () => {
  expect(ph.perceptualHashes(image(100, 100, () => 0.5))).toEqual([]);
  expect(ph.perceptualHashes(image(10, 10, scene))).toEqual([]);
  expect(ph.perceptualHashes(null)).toEqual([]);
});

test('Hamming distance on signed values', () => {
  expect(ph.hashDistance('0', '-1')).toBe(64);
  expect(ph.hashDistance('5', '6')).toBe(2);
});

test('moderate-photo hashes the bytes it already downloaded, after the exact-copy fingerprint, JPEG only, never failing screening', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'moderate-photo', 'index.ts'), 'utf8');
  expect(s).toMatch(/from '\.\.\/_shared\/perceptualHash\.js'/);
  expect(s.indexOf("rpc('record_photo_fingerprint'")).toBeLessThan(s.indexOf("rpc('record_photo_perceptual_hashes'"));
  expect(s.indexOf("rpc('record_photo_perceptual_hashes'")).toBeLessThan(s.indexOf("callRekognition('DetectModerationLabels'"));
  expect(s).toMatch(/imageBytes\[0\] === 0xff && imageBytes\[1\] === 0xd8/);
  expect(s).toMatch(/p_object_id: screenedObjectId,\n\s+p_hashes: hashes/);
  // the hashing sits in its own try/catch, so a decode failure never blocks or changes screening
  const block = s.slice(s.indexOf('20270368: perceptual hashes'), s.indexOf("let binaryString"));
  expect(block).toMatch(/try \{[\s\S]*\} catch \(phErr\)/);
});
