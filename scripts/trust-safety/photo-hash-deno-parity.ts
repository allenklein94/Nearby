// Parity check for near-duplicate hashing (20270368): runs the EXACT decode + hash path moderate-photo uses (Deno,
// npm:jpeg-js, supabase/functions/_shared/perceptualHash.js) over a folder of local test photos and compares the result
// with the hashes the Node calibration recorded (Jimp decode). Local only; nothing is uploaded.
//   docker run --rm -v "$PWD:/repo" -v "<photos>:/photos" -w /repo denoland/deno:alpine-1.45.5 \
//     run --allow-read scripts/trust-safety/photo-hash-deno-parity.ts /photos/node-hashes.json /photos
// node-hashes.json = calibrate-photo-hashes.js --hashes output; its ids are paths relative to the repo, re-rooted here
// by file name under the photo folder given.
import jpeg from 'npm:jpeg-js@0.4.4';
import { perceptualHashes, hashDistance } from '../../supabase/functions/_shared/perceptualHash.js';

const [hashFile, photoRoot] = Deno.args;
const expected = JSON.parse(await Deno.readTextFile(hashFile)) as { id: string; raw: Record<string, { dhash: string; phash: string }> }[];
let compared = 0;
let identical = 0;
let maxD = 0;
let maxP = 0;
for (const item of expected) {
  const rel = item.id.split('/photos/')[1] ?? item.id;
  const bytes = await Deno.readFile(`${photoRoot}/${rel}`);
  // the same check + options as moderate-photo
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) continue;
  const pixels = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
  const got = Object.fromEntries(perceptualHashes(pixels).map((h) => [h.variant, h]));
  for (const v of Object.keys(item.raw)) {
    compared += 1;
    const d = hashDistance(got[v].dhash, item.raw[v].dhash);
    const p = hashDistance(got[v].phash, item.raw[v].phash);
    if (d === 0 && p === 0) identical += 1;
    maxD = Math.max(maxD, d);
    maxP = Math.max(maxP, p);
  }
}
console.log(JSON.stringify({ compared, identical, maxDhashDistance: maxD, maxPhashDistance: maxP }));
