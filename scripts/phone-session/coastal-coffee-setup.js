#!/usr/bin/env node
// Coastal Coffee test setup (owner decisions 2026-11-14 + 2026-11-15): make the owner's existing business usable for end-to-end
// request testing with CLEARLY LABELLED test data. The audit found the row simply incomplete (no address, pin, hours, largest
// group or specific category; the save paths work), not a saving defect.
//   node scripts/phone-session/coastal-coffee-setup.js plan      read-only: current values (the restore snapshot), every change,
//                                                               an approval code for exactly that
//   node scripts/phone-session/coastal-coffee-setup.js check     the same writes inside a transaction that is ALWAYS rolled back;
//                                                               reads the result back through the server's rules + side effects
//   node scripts/phone-session/coastal-coffee-setup.js apply --production --confirm=<code>    only after the owner approves the plan;
//                                                               refuses if the row changed since the plan; saves the snapshot
//   node scripts/phone-session/coastal-coffee-setup.js restore --production --confirm=<code from restore-plan>
//   node scripts/phone-session/coastal-coffee-setup.js restore-plan   read-only: what restore would put back + its code
// Settings (env): COASTAL_LAT, COASTAL_LNG (required, a SYNTHETIC test point), COASTAL_TZ (America/New_York), COASTAL_OPEN /
// COASTAL_CLOSE (07:00 / 18:00), COASTAL_MAX_GROUP (10), COASTAL_AUTO_ACCEPT (10).
// Labelled so it can't pass for a real place: name gets " (test)", description says it is a test business, address says it is
// not a real address. There is no test/hidden flag on businesses (only `active`, which would also stop routing), so the labels
// are the safeguard: anyone signed in near the point sees "Coastal Coffee (test)" on Discover while it is set up.
// Largest group (brand_partners.max_group_size: the routing limit) and auto-accept party size (the fulfillment policy's
// auto_accept_party_size_max: which requests get an automatic reply) are separate fields and stay separate; the policy's
// party_size_min/max range is not touched. Nothing else on the row, its owner, offers or other businesses is touched.
const L = require('./lib');
const crypto = require('crypto');
const fs = require('fs');

const BUSINESS_ID = '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; // Coastal Coffee (read-only lookup 2026-11-15)
const SNAPSHOT_FILE = '/workspaces/.nearby-verify/coastal-coffee-before.json';
const TEST_SUFFIX = ' (test)';
const TEST_ADDRESS = 'Test location (not a real address)';
const TEST_DESCRIPTION = 'Test business for Nearby testing. Not a real location.';
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);

function config() {
  const e = process.env;
  const c = {
    lat: num(e.COASTAL_LAT), lng: num(e.COASTAL_LNG), tz: e.COASTAL_TZ || 'America/New_York',
    open: e.COASTAL_OPEN || '07:00', close: e.COASTAL_CLOSE || '18:00',
    maxGroup: e.COASTAL_MAX_GROUP ? num(e.COASTAL_MAX_GROUP) : 10, autoAccept: e.COASTAL_AUTO_ACCEPT ? num(e.COASTAL_AUTO_ACCEPT) : 10,
  };
  const problems = [];
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) problems.push('COASTAL_LAT and COASTAL_LNG (a synthetic test point) are required');
  if (!hhmm.test(c.open) || !hhmm.test(c.close) || c.open >= c.close) problems.push('COASTAL_OPEN / COASTAL_CLOSE must be HH:MM with open before close');
  for (const [k, v] of [['COASTAL_MAX_GROUP', c.maxGroup], ['COASTAL_AUTO_ACCEPT', c.autoAccept]]) if (!Number.isInteger(v) || v < 1 || v > 500) problems.push(`${k} must be a whole number 1-500`);
  if (problems.length) throw new Error(problems.join('; '));
  c.lat = Math.round(c.lat * 1e6) / 1e6;
  c.lng = Math.round(c.lng * 1e6) / 1e6;
  return c;
}

const hoursJson = (c) => JSON.stringify({ timezone: c.tz, week: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [[c.open, c.close]]])) });

const ROW_FIELDS = 'name, description, address, latitude, longitude, location_source, google_place_id, subcategory, max_group_size, operating_hours';
const snapshotSql = `select json_build_object(
  'business', (select row_to_json(x) from (select ${ROW_FIELDS} from brand_partners where id = '${BUSINESS_ID}') x),
  'policy', (select json_build_object('id', id, 'auto_accept_party_size_max', auto_accept_party_size_max, 'party_size_min', party_size_min, 'party_size_max', party_size_max)
             from business_fulfillment_policies where partner_id = '${BUSINESS_ID}')) as snap`;

// What apply writes. Location/category/size/hours fill ONLY empty fields (never overwrite a value the owner saved).
function target(c, before) {
  const b = before.business;
  const pinEmpty = b.latitude == null && b.longitude == null;
  return {
    business: {
      name: b.name.endsWith(TEST_SUFFIX) ? b.name : b.name + TEST_SUFFIX,
      description: TEST_DESCRIPTION,
      address: b.address ?? TEST_ADDRESS,
      latitude: pinEmpty ? c.lat : b.latitude,
      longitude: pinEmpty ? c.lng : b.longitude,
      location_source: pinEmpty ? 'host_pin' : b.location_source,
      subcategory: b.subcategory ?? 'Coffee',
      max_group_size: b.max_group_size ?? c.maxGroup,
      operating_hours: b.operating_hours ?? JSON.parse(hoursJson(c)),
    },
    policy: before.policy ? { auto_accept_party_size_max: c.autoAccept } : null,
  };
}

const jsonb = (v) => (v == null ? 'null' : `${q(JSON.stringify(v))}::jsonb`);
const setBusinessSql = (v) => `update brand_partners set name = ${q(v.name)}, description = ${q(v.description)}, address = ${q(v.address)},
    latitude = ${v.latitude ?? 'null'}, longitude = ${v.longitude ?? 'null'}, location_source = ${q(v.location_source)}, subcategory = ${q(v.subcategory)},
    max_group_size = ${v.max_group_size ?? 'null'}, operating_hours = ${jsonb(v.operating_hours)}
  where id = '${BUSINESS_ID}'`;
const setPolicySql = (n) => `update business_fulfillment_policies set auto_accept_party_size_max = ${n ?? 'null'}, updated_at = now() where partner_id = '${BUSINESS_ID}'`;

// One transaction: refuses (writes nothing) unless the row still equals `expect`, then writes `to`.
// rollback = run everything, report, then raise so nothing commits.
function writeSql(expect, to, { rollback }) {
  return `do $cc$
declare cur jsonb; before_push bigint; report jsonb;
begin
  select (${snapshotSql.replace(' as snap', '')})::jsonb into cur;
  if cur <> ${q(JSON.stringify(expect))}::jsonb then
    raise exception 'COASTAL_CHANGED the business or its policy changed since the plan: nothing written. Now: %', cur::text;
  end if;
  select count(*) into before_push from public.push_outbox;
  ${setBusinessSql(to.business)};
  ${to.policy ? setPolicySql(to.policy.auto_accept_party_size_max) : '-- no policy row'};
  report := jsonb_build_object(
    'after', (${snapshotSql.replace(' as snap', '')})::jsonb,
    'offered_tags', (select to_jsonb(public.business_offered_tags('${BUSINESS_ID}'))),
    'pushes_queued_by_the_change', (select count(*) from public.push_outbox) - before_push);
  ${rollback ? "raise exception 'COASTAL_CHECK %', report::text;" : "raise notice 'COASTAL_DONE %', report::text;"}
end $cc$;`;
}

const short = (snap) => JSON.parse(JSON.stringify(snap, (k, v) => (k === 'operating_hours' && v && v.week ? `7 days ${v.week.mon?.[0]?.join('-')} ${v.timezone}` : v)));

async function readSnapshot() {
  const s = (await L.run(snapshotSql))[0]?.snap;
  if (!s?.business) throw new Error(`no business with id ${BUSINESS_ID}`);
  return s;
}

async function main() {
  const [mode = 'plan', ...flags] = process.argv.slice(2);
  const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
  console.log(`Target: ${L.target()}`);
  const now = await readSnapshot();
  const authorize = (code) => {
    if (L.isLocal()) return;
    if (!flag('production')) throw new Error('this would write to PRODUCTION: refusing without --production (and only after the owner approved the plan)');
    const given = (flag('confirm') || '').split('=')[1];
    if (given !== code) throw new Error(`the approved code is ${code}; --confirm=${given || '(none)'} does not match. Nothing written.`);
  };

  if (mode === 'restore-plan' || mode === 'restore') {
    if (!fs.existsSync(SNAPSHOT_FILE)) throw new Error(`no snapshot at ${SNAPSHOT_FILE}: apply was never run from here`);
    const saved = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    const code = sha({ restore: saved, expect: saved.applied });
    if (mode === 'restore-plan') {
      console.log(JSON.stringify({ now: short(now), would_restore_to: short(saved.before) }, null, 2));
      console.log(`\nRestore approval code: ${code} (refuses if anything was changed after apply)`);
      return;
    }
    authorize(code);
    await L.run(writeSql(saved.applied, { business: saved.before.business, policy: saved.before.policy }, { rollback: false }));
    console.log(JSON.stringify(short(await readSnapshot()), null, 2));
    return;
  }

  if (!['plan', 'check', 'apply'].includes(mode)) throw new Error(`unknown mode ${mode} (plan | check | apply | restore-plan | restore)`);
  const c = config();
  const to = target(c, now);
  const code = sha({ c, before: now, to });
  if (mode === 'plan') {
    console.log(JSON.stringify({ before_restore_snapshot: short(now), after: short(to) }, null, 2));
    console.log(`\nApproval code for exactly this plan: ${code} (changes if the row, the policy or the settings change)`);
    return;
  }
  if (mode === 'check') {
    try {
      await L.run(writeSql(now, to, { rollback: true }));
      throw new Error('check did not roll back as expected');
    } catch (e) {
      const m = /COASTAL_CHECK (\{.*\})/s.exec(String(e.message || e));
      if (!m) throw e;
      console.log(JSON.stringify(short(JSON.parse(m[1])), null, 2));
      console.log('\nRolled back: nothing was written.');
    }
    return;
  }
  authorize(code);
  await L.run(writeSql(now, to, { rollback: false }));
  const applied = await readSnapshot();
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ at: new Date().toISOString(), before: now, applied }, null, 2));
  console.log(JSON.stringify(short(applied), null, 2));
  console.log(`\nSnapshot for restore saved to ${SNAPSHOT_FILE}. Restore: run restore-plan, then restore with its code.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
module.exports = { BUSINESS_ID, config, target, writeSql, snapshotSql };
