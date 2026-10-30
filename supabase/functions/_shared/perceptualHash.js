// Perceptual photo hashes for admin near-duplicate review (migration 20270368). Plain JavaScript with no imports, so the
// SAME file runs in the moderate-photo edge function (Deno) and in the Node calibration + Jest tests.
//
// Input: decoded pixels { width, height, data } with 4 bytes per pixel (RGBA, as jpeg-js and Jimp return them).
// Output: two 64-bit hashes (dHash = gradient, pHash = low-frequency DCT) for each of six VARIANTS of the photo:
//   full            the whole photo
//   mirror          the whole photo flipped left-right
//   crop90          the centre 90% (5% trimmed from every edge)
//   crop90_mirror   the centre 90%, flipped
//   crop80          the centre 80% (10% trimmed from every edge)
//   crop80_mirror   the centre 80%, flipped
// A copy is recognised when BOTH hashes are within the approved distances (private.account_signal_settings): requiring
// both keeps false matches down. Never identity, never a face, never AI: two numbers that change little when a photo is
// resized, re-saved, lightly filtered, mirrored or trimmed by up to about 20% (measured, see
// PRODUCT_AUDIT/PHOTO_SIMILARITY_CALIBRATION_2026-10-30.md). Heavy crops, rotations, collages and photos of a screen are
// not caught.
// Hashes are returned as signed 64-bit decimal strings (Postgres bigint).

export const HASH_VERSION = 1;
export const VARIANTS = ['full', 'mirror', 'crop90', 'crop90_mirror', 'crop80', 'crop80_mirror'];
const CROPS = [['full', 1], ['crop90', 0.9], ['crop80', 0.8]];
const WORK_MAX = 256; // the photo is first averaged down to at most this many pixels on its longer side

// Luma (Rec. 601) of every pixel.
export function toGray({ width, height, data }) {
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { width, height, gray: out };
}

// Area-average resample of a region (x0, y0, w, h) of a grey image to tw x th: every source pixel contributes by the
// fraction of it each target cell covers, so the result does not depend on the source size (resize-stable).
export function areaResample(img, tw, th, x0 = 0, y0 = 0, w = img.width, h = img.height) {
  const out = new Float64Array(tw * th);
  const sx = w / tw;
  const sy = h / th;
  for (let ty = 0; ty < th; ty += 1) {
    const top = y0 + ty * sy;
    const bottom = top + sy;
    for (let tx = 0; tx < tw; tx += 1) {
      const left = x0 + tx * sx;
      const right = left + sx;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
        const wy = Math.min(bottom, y + 1) - Math.max(top, y);
        if (wy <= 0 || y < 0 || y >= img.height) continue;
        for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
          const wx = Math.min(right, x + 1) - Math.max(left, x);
          if (wx <= 0 || x < 0 || x >= img.width) continue;
          sum += img.gray[y * img.width + x] * wx * wy;
          area += wx * wy;
        }
      }
      out[ty * tw + tx] = area > 0 ? sum / area : 0;
    }
  }
  return out;
}

function mirrorGrid(grid, w, h) {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[y * w + x] = grid[y * w + (w - 1 - x)];
  return out;
}

// 64 bits (index 0 = most significant) -> signed 64-bit decimal string.
function bitsToSigned(bits) {
  let v = 0n;
  for (const b of bits) v = (v << 1n) | (b ? 1n : 0n);
  return BigInt.asIntN(64, v).toString();
}

// dHash: 9 x 8 grid, each bit = is this cell darker than its right neighbour.
export function dHashBits(grid9x8) {
  const bits = [];
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits.push(grid9x8[y * 9 + x] < grid9x8[y * 9 + x + 1]);
  return bits;
}

let cosTable = null;
function cosines() {
  if (cosTable) return cosTable;
  cosTable = new Float64Array(32 * 32);
  for (let u = 0; u < 32; u += 1) for (let x = 0; x < 32; x += 1) cosTable[u * 32 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 64);
  return cosTable;
}

// pHash: 32 x 32 grid -> 2-D DCT-II -> the 8 x 8 lowest frequencies; each bit = above the median of those 64 values
// (the DC term is left out of the median, as it only measures overall brightness).
export function pHashBits(grid32) {
  const c = cosines();
  const rows = new Float64Array(32 * 8); // DCT along x, first 8 frequencies
  for (let y = 0; y < 32; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let s = 0;
      for (let x = 0; x < 32; x += 1) s += grid32[y * 32 + x] * c[u * 32 + x];
      rows[y * 8 + u] = s;
    }
  }
  const coef = new Float64Array(64);
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let s = 0;
      for (let y = 0; y < 32; y += 1) s += rows[y * 8 + u] * c[v * 32 + y];
      coef[v * 8 + u] = s;
    }
  }
  const sorted = Array.from(coef.slice(1)).sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  return Array.from(coef, (x) => x > median);
}

// Is the photo usable at all? A flat image (one colour) has no structure to compare and would match every other flat
// image, so it gets no hash.
function hasStructure(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid) { if (v < min) min = v; if (v > max) max = v; }
  return max - min >= 8;
}

// All six variants' hashes, or [] when the photo can't be hashed (too small, flat).
export function perceptualHashes(pixels) {
  if (!pixels || !(pixels.width >= 16) || !(pixels.height >= 16) || !pixels.data) return [];
  const full = toGray(pixels);
  const scale = Math.min(1, WORK_MAX / Math.max(full.width, full.height));
  const ww = Math.max(16, Math.round(full.width * scale));
  const wh = Math.max(16, Math.round(full.height * scale));
  const work = { width: ww, height: wh, gray: areaResample(full, ww, wh) };
  const out = [];
  for (const [base, keep] of CROPS) {
    const w = ww * keep;
    const h = wh * keep;
    const x0 = (ww - w) / 2;
    const y0 = (wh - h) / 2;
    const d = areaResample(work, 9, 8, x0, y0, w, h);
    const p = areaResample(work, 32, 32, x0, y0, w, h);
    if (!hasStructure(p)) return [];
    // the mirrored dHash needs its own 9 x 8 grid read right-to-left; pHash mirrors its 32 x 32 grid
    out.push({ variant: base, dhash: bitsToSigned(dHashBits(d)), phash: bitsToSigned(pHashBits(p)) });
    out.push({
      variant: base === 'full' ? 'mirror' : `${base}_mirror`,
      dhash: bitsToSigned(dHashBits(mirrorGrid(d, 9, 8))),
      phash: bitsToSigned(pHashBits(mirrorGrid(p, 32, 32))),
    });
  }
  return out;
}

// Hamming distance of two signed 64-bit decimal strings (tests + calibration; the database uses bit_count).
export function hashDistance(a, b) {
  let x = BigInt.asUintN(64, BigInt(a) ^ BigInt(b));
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
