#!/usr/bin/env node
// Shared-device (20270376) + shared-text (20270378) + shared-link (20270413) detectors: the one way to turn them on, and off. Both are installed OFF and store nothing; no migration turns them on
// (owner, 2026-11-08: prepare for controlled activation, no production collection without separate approval). Reads state, or changes the settings row; never touches a case,
// account, token or text. Prints settings + counts only, never ids or keys.
//   node scripts/trust-safety/detector-switch.js status --target=prod                                READ-ONLY
//   NEARBY_DETECTOR_APPROVAL=<code from status> node ... on --detector=device|text|link --target=prod     needs every gate below
//   NEARBY_DETECTOR_APPROVAL=detector-off node ... off --detector=device|text|link|all --target=prod instant; cases stay for an admin; kept keys age out (device 90 days, text + link 30)
// `on` commits the numbers, then in a SEPARATE transaction backfills once: something written while the numbers commit judges itself (scripts/replay/shared-*-concurrency.js).
// The numbers below are the owner's recorded PREFERENCES, not validated: readiness doc = PRODUCT_AUDIT/DETECTOR_ACTIVATION_READINESS_2026-11-08.md. A code never outlives a
// change to them, to the detector's migration or to this file's gates. Changing a number = change it here, new code, owner approval.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OFF_CODE = 'detector-off';
const DETECTORS = Object.freeze({
  device: {
    migration: '20270376_shared_device_signals.sql',
    numbers: Object.freeze({ shared_device_min_accounts: 4, shared_device_suspended_enabled: true }),
    off: 'shared_device_min_accounts = null, shared_device_suspended_enabled = false',
    backfill: 'select private.backfill_device_sightings() as result',
    secret: 'private.device_signal_secret',
    tables: ['private.device_sightings', 'private.suspended_device_keys', 'private.account_review_case_devices'],
    job: 'purge-device-sightings',
    disclosure: 'detector-disclosure:shared-device',
  },
  text: {
    migration: '20270378_shared_public_text_signals.sql',
    numbers: Object.freeze({ shared_text_min_accounts: 5 }),
    off: 'shared_text_min_accounts = null',
    backfill: 'select private.backfill_shared_text_sightings() as result',
    secret: 'private.text_signal_secret',
    tables: ['private.text_sightings', 'private.shared_text_excluded_keys'],
    job: 'purge-text-sightings',
    disclosure: 'detector-disclosure:shared-text',
  },
  // owner 2026-11-12: 5 distinct accounts in 30 days, public gatherings only (a proposed starting point, not calibrated)
  link: {
    migration: '20270413_shared_link_signals.sql',
    numbers: Object.freeze({ shared_link_min_accounts: 5 }),
    off: 'shared_link_min_accounts = null',
    backfill: 'select private.backfill_link_sightings() as result',
    secret: 'private.link_signal_secret',
    tables: ['private.link_sightings', 'private.shared_link_excluded_keys', 'private.shared_link_platforms', 'private.account_review_case_link_keys'],
    job: 'purge-link-sightings',
    disclosure: 'detector-disclosure:shared-link',
  },
});

const literal = (v) => (typeof v === 'string' ? `'${v}'` : String(v));
const onUpdate = (d) => `update private.account_signal_settings set ${Object.entries(DETECTORS[d].numbers).map(([k, v]) => `${k} = ${literal(v)}`).join(', ')}, updated_at = now() where id`;
const offUpdate = (d) => `update private.account_signal_settings set ${(d === 'all' ? Object.values(DETECTORS) : [DETECTORS[d]]).map((x) => x.off).join(', ')}, updated_at = now() where id`;

const statusSql = () => `select jsonb_build_object(${Object.entries(DETECTORS).map(([d, x]) => `'${d}', jsonb_build_object(
    'installed', to_regclass('${x.secret}') is not null,
    'secret_ok', case when to_regclass('${x.secret}') is null then false else (select count(*) = 1 and bool_and(length(secret) = 32) from ${x.secret}) end,
    'client_access', ${[x.secret, ...x.tables].map((t) => `coalesce(has_table_privilege('anon', to_regclass('${t}'), 'select') or has_table_privilege('authenticated', to_regclass('${t}'), 'select') or has_table_privilege('service_role', to_regclass('${t}'), 'select'), false)`).join(' or ')},
    'purge_job', exists (select 1 from cron.job where jobname = '${x.job}' and active),
    'rows', ${x.tables.map((t) => `(select count(*) from ${t})`).join(' + ')})`).join(',\n  ')},
  'settings', (select to_jsonb(s) - 'id' from private.account_signal_settings s where id),
  'open_cases', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select signal || ':' || status k, count(*) n from private.account_review_cases where signal in ('shared_device', 'shared_text', 'shared_link') group by 1) y)) as status`;

const policyText = () => fs.readFileSync(path.join(ROOT, 'docs/privacy.html'), 'utf8');
const approvalCode = (d, migrationText = fs.readFileSync(path.join(ROOT, 'supabase/migrations', DETECTORS[d].migration), 'utf8')) => `detector-on:${d}:${crypto.createHash('sha256')
  .update(JSON.stringify({ d, numbers: DETECTORS[d].numbers, migration: crypto.createHash('sha256').update(migrationText).digest('hex') })).digest('hex').slice(0, 24)}`;

// Pure: why `on` must refuse. Every gate is one the owner set (CLAUDE.md, 2026-11-01); each is read from the thing itself, never from a flag someone sets.
function onRefusals(d, status, policy) {
  const r = []; const s = status?.[d] || {};
  if (!s.installed) r.push(`${DETECTORS[d].migration} is not deployed`);
  if (!s.secret_ok) r.push('its server secret is missing or the wrong length');
  if (s.client_access) r.push('a client or service role can read its secret or tables');
  if (!s.purge_job) r.push(`its retention job ${DETECTORS[d].job} isn't scheduled`);
  if (!policy.includes(DETECTORS[d].disclosure)) r.push(`the published Privacy Policy (docs/privacy.html) doesn't carry the approved disclosure (marker ${DETECTORS[d].disclosure})`);
  if (d === 'device' && /used solely to deliver notifications/.test(policy)) r.push('the published Privacy Policy still says the push token is used solely to deliver notifications');
  return r;
}

async function main(argv, env = process.env) {
  const mode = argv.find((a) => !a.startsWith('--')) || 'status';
  const which = (argv.find((a) => a.startsWith('--detector=')) || '').split('=')[1];
  const target = (argv.find((a) => a.startsWith('--target=')) || '').split('=')[1];
  const { name, run } = require('../migrations/ledger').runner(target);
  const [{ status }] = await run(statusSql());
  console.log(`target: ${name}\nnow: ${JSON.stringify(status)}`);
  if (mode === 'status') {
    for (const d of Object.keys(DETECTORS)) {
      console.log(`${d}: numbers ${JSON.stringify(DETECTORS[d].numbers)}, on approval ${approvalCode(d)}`);
      const refusals = onRefusals(d, status, policyText());
      if (refusals.length) console.log(`"on --detector=${d}" would refuse:\n- ${refusals.join('\n- ')}`);
    }
    return 0;
  }
  if (mode === 'off') {
    if (![...Object.keys(DETECTORS), 'all'].includes(which)) { console.error('--detector=device|text|link|all required'); return 2; }
    if (env.NEARBY_DETECTOR_APPROVAL !== OFF_CODE) { console.error(`REFUSED: NEARBY_DETECTOR_APPROVAL=${OFF_CODE} required`); return 2; }
    await run(`${offUpdate(which)};\nselect 1 as done`);
    const [{ status: after }] = await run(statusSql());
    console.log(`after: ${JSON.stringify(after)}`);
    return 0;
  }
  if (mode === 'on') {
    if (!DETECTORS[which]) { console.error('--detector=device|text|link required'); return 2; }
    const refusals = onRefusals(which, status, policyText());
    if (env.NEARBY_DETECTOR_APPROVAL !== approvalCode(which)) refusals.push(`NEARBY_DETECTOR_APPROVAL must equal the code from status`);
    if (refusals.length) { console.error(`REFUSED (nothing sent):\n- ${refusals.join('\n- ')}`); return 2; }
    await run(`${onUpdate(which)};\nselect 1 as done`);
    const rows = await run(DETECTORS[which].backfill);
    console.log(`backfill: ${JSON.stringify(rows[0]?.result)}`);
    const [{ status: after }] = await run(statusSql());
    console.log(`after: ${JSON.stringify(after)}`);
    return 0;
  }
  console.error('mode must be status, on or off');
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
module.exports = { DETECTORS, OFF_CODE, onUpdate, offUpdate, statusSql, approvalCode, onRefusals, main };
