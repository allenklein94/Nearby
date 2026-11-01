#!/usr/bin/env node
// Duplicate-photo detection switch (owner, 2026-11-01). Detection is turned ON by migration 20270380 (deployed through
// deploy.js with its own approval); this script only READS the state, turns detection OFF at once, or turns it back ON
// at exactly the approved numbers after an off. It never touches a review case, an account or a photo: cases already
// opened stay open for an admin (they never restricted anyone).
//   node scripts/trust-safety/photo-detection-switch.js status --target=prod                READ-ONLY
//   NEARBY_PHOTO_DETECTION_APPROVAL=photo-detection-off node ... off [--all] --target=prod  instant
//   NEARBY_PHOTO_DETECTION_APPROVAL=<code from status> node ... on [--all] --target=prod
//   NEARBY_PHOTO_DETECTION_APPROVAL=photo-detection-sweep node ... sweep --target=prod   judge existing photos once more
// off        = near-duplicate matching off (distances null); exact copies keep 20270358's rules.
// off --all  = exact copies off too (accounts + name similarity null): no photo case of either kind opens.
// on [--all] = back to the approved numbers (near: dHash 10 / pHash 10; --all also exact: 3 accounts / names 0.5), COMMITTED,
//              then, in a SEPARATE transaction, every already-fingerprinted photo is judged once
//              (private.evaluate_existing_photo_signals, from 20270380).
// sweep      = that judgement alone. Needed once right after 20270380 is deployed: a photo recorded WHILE the activation
//              transaction was open saw detection off and was not yet visible to the migration's own sweep (proven by
//              scripts/replay/review-case-concurrency.js step 6); anything recorded after the commit judges itself.
//              Idempotent: never a second case, never reopens a closed one, never touches an account.
// --target=local runs against NEARBY_LOCAL_DB_URL (a disposable database). Prints settings + counts only, never ids/hashes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270380_photo_detection_activation.sql');
// The owner's approved numbers (exact: 2026-10-29 via 20270358; near: 2026-10-30 calibration decision).
const APPROVED = Object.freeze({ dhash: 10, phash: 10, minAccounts: 3, nameSimilarity: 0.5 });
const OFF_CODE = 'photo-detection-off';

const STATUS_SQL = `select jsonb_build_object(
  'activation_installed', to_regprocedure('private.evaluate_existing_photo_signals()') is not null,
  'settings', (select jsonb_build_object('min_accounts', duplicate_photo_min_accounts, 'name_similarity', similar_name_min_similarity,
                 'max_dhash', similar_photo_max_dhash, 'max_phash', similar_photo_max_phash, 'updated_at', updated_at)
                 from private.account_signal_settings where id),
  'fingerprinted_photos', (select count(*) from private.photo_fingerprints),
  'hashed_photos', (select count(distinct object_id) from private.photo_perceptual_hashes),
  'cases', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select signal || ':' || status k, count(*) n
              from private.account_review_cases where signal in ('identical_photo', 'similar_photo') group by 1) x)) as status`;

// The two settings writes (also run verbatim by journey photoDetectionActivation, so the tested statement is the sent one).
const offUpdate = (all) => `update private.account_signal_settings
   set similar_photo_max_dhash = null, similar_photo_max_phash = null,${all ? ' duplicate_photo_min_accounts = null, similar_name_min_similarity = null,' : ''} updated_at = now()
 where id`;
const onUpdate = (all) => `update private.account_signal_settings
   set similar_photo_max_dhash = ${APPROVED.dhash}, similar_photo_max_phash = ${APPROVED.phash},${all ? ` duplicate_photo_min_accounts = ${APPROVED.minAccounts}, similar_name_min_similarity = ${APPROVED.nameSimilarity},` : ''} updated_at = now()
 where id`;
const SWEEP_SQL = 'select private.evaluate_existing_photo_signals() as result';
const SWEEP_CODE = 'photo-detection-sweep';
const offSql = (all) => `${offUpdate(all)};\n${STATUS_SQL}`;

// The code binds the activation migration's exact text and the numbers `on` would set.
const approvalCode = (all, migrationText = fs.readFileSync(MIGRATION, 'utf8')) => `photo-detection-on:${crypto.createHash('sha256')
  .update(JSON.stringify({ all: !!all, approved: APPROVED, migration: crypto.createHash('sha256').update(migrationText).digest('hex') }))
  .digest('hex').slice(0, 24)}`;

// Pure: status -> why `on` must refuse.
function onRefusals(status, all) {
  const r = [];
  if (!status?.activation_installed) r.push('20270380 is not deployed (private.evaluate_existing_photo_signals missing): deploy it through deploy.js');
  const s = status?.settings || {};
  if (!all && (s.min_accounts !== APPROVED.minAccounts || Number(s.name_similarity) !== APPROVED.nameSimilarity)) {
    r.push(`exact-copy rules are not the approved ${APPROVED.minAccounts} / ${APPROVED.nameSimilarity} (found ${s.min_accounts} / ${s.name_similarity}): use "on --all" or fix them first`);
  }
  return r;
}

async function main(argv, env = process.env) {
  const mode = argv.find((a) => !a.startsWith('--')) || 'status';
  const all = argv.includes('--all');
  const target = (argv.find((a) => a.startsWith('--target=')) || '').split('=')[1];
  const { name, run } = require('../migrations/ledger').runner(target);
  const [{ status }] = await run(STATUS_SQL);
  console.log(`target: ${name}\nnow: ${JSON.stringify(status)}`);
  if (mode === 'status') {
    console.log(`on approval: ${approvalCode(false)}   on --all approval: ${approvalCode(true)}`);
    const refusals = onRefusals(status, false);
    if (refusals.length) console.log(`"on" would refuse:\n- ${refusals.join('\n- ')}`);
    return 0;
  }
  if (mode === 'off') {
    if (env.NEARBY_PHOTO_DETECTION_APPROVAL !== OFF_CODE) { console.error(`REFUSED: NEARBY_PHOTO_DETECTION_APPROVAL=${OFF_CODE} required`); return 2; }
    const rows = await run(offSql(all));
    const after = rows[rows.length - 1]?.status || rows[0]?.status;
    const ok = after?.settings?.max_dhash == null && after?.settings?.max_phash == null && (!all || (after.settings.min_accounts == null && after.settings.name_similarity == null));
    console.log(`after: ${JSON.stringify(after)}\n${ok ? (all ? 'ALL PHOTO DETECTION OFF' : 'NEAR-DUPLICATE DETECTION OFF') : 'MISMATCH'}`);
    return ok ? 0 : 1;
  }
  if (mode === 'on') {
    const refusals = onRefusals(status, all);
    if (env.NEARBY_PHOTO_DETECTION_APPROVAL !== approvalCode(all)) refusals.push(`NEARBY_PHOTO_DETECTION_APPROVAL must equal ${all ? 'the "on --all"' : 'the "on"'} code from status`);
    if (refusals.length) { console.error(`REFUSED (nothing sent):\n- ${refusals.join('\n- ')}`); return 2; }
    await run(`${onUpdate(all)};\nselect 1 as done`); // committed on its own, so every later recording judges itself
    const rows = await run(SWEEP_SQL);
    console.log(`judged existing photos: ${JSON.stringify(rows[0]?.result)}`);
    const [{ status: after }] = await run(STATUS_SQL);
    console.log(`after: ${JSON.stringify(after)}`);
    return 0;
  }
  if (mode === 'sweep') {
    if (env.NEARBY_PHOTO_DETECTION_APPROVAL !== SWEEP_CODE) { console.error(`REFUSED: NEARBY_PHOTO_DETECTION_APPROVAL=${SWEEP_CODE} required`); return 2; }
    if (!status?.activation_installed) { console.error('REFUSED: 20270380 is not deployed'); return 2; }
    const rows = await run(SWEEP_SQL);
    console.log(`judged existing photos: ${JSON.stringify(rows[0]?.result)}`);
    return 0;
  }
  console.error('mode must be status, off, on or sweep');
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
module.exports = { APPROVED, OFF_CODE, SWEEP_CODE, SWEEP_SQL, STATUS_SQL, offUpdate, onUpdate, offSql, approvalCode, onRefusals, main };
