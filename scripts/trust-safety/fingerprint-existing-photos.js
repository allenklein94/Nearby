// I1 (20270357) + 20270368: fingerprint the profile photos that were uploaded before the moderate-photo redeploy (new
// uploads are fingerprinted by `moderate-photo`). For every photo an account is using (main + extras) it downloads the
// file, takes the SHA-256 of its bytes and records it through record_photo_fingerprint, and (once 20270368 is live) the
// perceptual hashes of the SAME bytes through record_photo_perceptual_hashes, with the SAME hash module moderate-photo uses
// (supabase/functions/_shared/perceptualHash.js; JPEG only, like the function). Decoded with Jimp, as the calibration was:
// the Deno jpeg-js path moderate-photo runs gave identical hashes (PRODUCT_AUDIT/PHOTO_SIMILARITY_CALIBRATION_2026-10-30.md). Both are service role only
// and may open a review case under the approved rules (exact: 20270358; near-duplicate: only once 20270380 sets the
// distances, which also judges every photo already hashed). Never changes a profile. Run right after 20270357 is deployed
// and again right after 20270368 + the moderate-photo redeploy (safe to repeat: it replaces each photo's own rows):
//   SUPABASE_URL=https://enmosvippabmuqslzrox.supabase.co SUPABASE_SECRET_KEY=<secret key, never pasted in chat> \
//     node scripts/trust-safety/fingerprint-existing-photos.js [--dry-run]
// Needs 20270349 (photo_screening_target) and 20270357 live; before 20270368 the perceptual step is skipped (counted as
// similarSkipped). --dry-run hashes the files and prints counts (nothing stored). Prints counts only, never paths or hashes.
const crypto = require('crypto');
const Jimp = require('jimp-compact');

// Perceptual hashes as moderate-photo computes them; [] for a non-JPEG or undecodable file (same check as the function).
async function perceptualHashesOf(bytes) {
  if (!(bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8)) return [];
  const { perceptualHashes } = await import('../../supabase/functions/_shared/perceptualHash.js');
  try {
    const im = await Jimp.read(Buffer.from(bytes));
    return perceptualHashes(im.bitmap);
  } catch {
    return [];
  }
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY');
  const dryRun = process.argv.includes('--dry-run');
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // The same target lookup moderate-photo uses (20270349): the photo's path AND its exact storage object id.
  const photos = [];
  const { data: mains, error: e1 } = await admin.from('profiles').select('id').not('photo_url', 'is', null);
  if (e1) throw e1;
  for (const p of mains) photos.push({ user: p.id, extra: null });
  const { data: extras, error: e2 } = await admin.from('profile_photos').select('id, user_id').not('photo_url', 'is', null);
  if (e2) throw e2;
  for (const p of extras) photos.push({ user: p.user_id, extra: p.id });

  const counts = { photos: photos.length, recorded: 0, notInUse: 0, missing: 0, failed: 0, similarRecorded: 0, similarNotJpeg: 0, similarSkipped: 0, similarFailed: 0 };
  for (const { user, extra } of photos) {
    const { data: rows, error: lookupError } = await admin.rpc('photo_screening_target', { p_user: user, p_extra: extra });
    if (lookupError) { counts.failed += 1; continue; }
    const target = Array.isArray(rows) ? rows[0] : rows;
    if (!target?.path || !target?.object_id) { counts.missing += 1; continue; }
    const { data: file, error: dlError } = await admin.storage.from('profile-photos').download(target.path);
    if (dlError || !file) { counts.failed += 1; continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const hashes = await perceptualHashesOf(bytes);
    if (!hashes.length) counts.similarNotJpeg += 1;
    if (dryRun) { counts.recorded += 1; if (hashes.length) counts.similarRecorded += 1; continue; }
    const { data: ok, error } = await admin.rpc('record_photo_fingerprint', { p_user: user, p_object_id: target.object_id, p_sha256: sha256 });
    if (error) counts.failed += 1;
    else if (ok) counts.recorded += 1;
    else counts.notInUse += 1;
    if (!hashes.length) continue;
    const { data: okH, error: errH } = await admin.rpc('record_photo_perceptual_hashes', { p_user: user, p_object_id: target.object_id, p_hashes: hashes });
    if (errH?.code === 'PGRST202') counts.similarSkipped += 1; // 20270368 not deployed yet
    else if (errH) counts.similarFailed += 1;
    else if (okH) counts.similarRecorded += 1;
  }
  console.log(JSON.stringify({ dryRun, ...counts }));
  if (counts.failed || counts.similarFailed) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { perceptualHashesOf };
