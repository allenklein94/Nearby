// I1 (20270357): fingerprint the profile photos that were uploaded before 20270357 was deployed (new uploads are
// fingerprinted by `moderate-photo`). For every photo an account is using (main + extras) it downloads the file, takes the
// SHA-256 of its bytes and records it through record_photo_fingerprint (service role only), which may open a review case
// under the approved rules (20270358). Never changes a profile. Run once, right after 20270357 is deployed:
//   SUPABASE_URL=https://enmosvippabmuqslzrox.supabase.co SUPABASE_SECRET_KEY=<secret key, never pasted in chat> \
//     node scripts/trust-safety/fingerprint-existing-photos.js [--dry-run]
// Needs 20270349 (photo_screening_target) and 20270357 live. --dry-run hashes the files and prints counts (no fingerprint stored). Prints counts only, never paths or hashes.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

async function main() {
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

  const counts = { photos: photos.length, recorded: 0, notInUse: 0, missing: 0, failed: 0 };
  for (const { user, extra } of photos) {
    const { data: rows, error: lookupError } = await admin.rpc('photo_screening_target', { p_user: user, p_extra: extra });
    if (lookupError) { counts.failed += 1; continue; }
    const target = Array.isArray(rows) ? rows[0] : rows;
    if (!target?.path || !target?.object_id) { counts.missing += 1; continue; }
    const { data: file, error: dlError } = await admin.storage.from('profile-photos').download(target.path);
    if (dlError || !file) { counts.failed += 1; continue; }
    const sha256 = crypto.createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
    if (dryRun) { counts.recorded += 1; continue; }
    const { data: ok, error } = await admin.rpc('record_photo_fingerprint', { p_user: user, p_object_id: target.object_id, p_sha256: sha256 });
    if (error) counts.failed += 1;
    else if (ok) counts.recorded += 1;
    else counts.notInUse += 1;
  }
  console.log(JSON.stringify({ dryRun, ...counts }));
  if (counts.failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
