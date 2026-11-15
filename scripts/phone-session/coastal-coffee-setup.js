#!/usr/bin/env node
// Coastal Coffee test setup (owner decision 1, 2026-11-14): fill the existing business's missing basics with CLEARLY LABELLED
// test data so nearby requests can reach it in end-to-end testing. The audit found the row simply incomplete (address, pin,
// hours, largest group, specific category all NULL; the save paths work), not a saving defect.
//   node scripts/phone-session/coastal-coffee-setup.js plan     read-only: current values, what would change, an approval code
//   node scripts/phone-session/coastal-coffee-setup.js check    applies inside a transaction that is ALWAYS rolled back, reads the
//                                                              result back through the server's own rules, reports side effects
//   node scripts/phone-session/coastal-coffee-setup.js apply --production --confirm=<code>   only after the owner approves the plan
// Settings (env, required): COASTAL_LAT, COASTAL_LNG = a TEST point the owner picks (city-level is enough; never a real
// business's address). Optional: COASTAL_TZ (default America/New_York), COASTAL_OPEN / COASTAL_CLOSE (default 07:00 / 18:00),
// COASTAL_MAX_GROUP (default 10). Target: NEARBY_LOCAL_DB_URL = that local DB; otherwise production via SUPABASE_ACCESS_TOKEN.
// Never touches the name, owner, fulfillment policy (auto-reply range stays as set), offers or anything else on the row.
const L = require('./lib');
const crypto = require('crypto');

const BUSINESS_ID = '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; // Coastal Coffee (read-only lookup 2026-11-15)
const TEST_ADDRESS = 'Test location (not a real address)';
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

function config() {
  const e = process.env;
  const c = {
    lat: num(e.COASTAL_LAT), lng: num(e.COASTAL_LNG), tz: e.COASTAL_TZ || 'America/New_York',
    open: e.COASTAL_OPEN || '07:00', close: e.COASTAL_CLOSE || '18:00', maxGroup: e.COASTAL_MAX_GROUP ? num(e.COASTAL_MAX_GROUP) : 10,
  };
  const problems = [];
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) problems.push('COASTAL_LAT and COASTAL_LNG (a test point) are required');
  if (!hhmm.test(c.open) || !hhmm.test(c.close) || c.open >= c.close) problems.push('COASTAL_OPEN / COASTAL_CLOSE must be HH:MM with open before close');
  if (!Number.isInteger(c.maxGroup) || c.maxGroup < 1 || c.maxGroup > 500) problems.push('COASTAL_MAX_GROUP must be a whole number 1-500');
  if (problems.length) throw new Error(problems.join('; '));
  c.lat = Math.round(c.lat * 1e6) / 1e6;
  c.lng = Math.round(c.lng * 1e6) / 1e6;
  return c;
}

// Same hours shape the phone-session seed writes (tested against the app's reader there).
const hoursJson = (c) => JSON.stringify({ timezone: c.tz, week: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [[c.open, c.close]]])) });

const changes = (c) => ({
  address: TEST_ADDRESS, latitude: c.lat, longitude: c.lng, location_source: 'host_pin', subcategory: 'Coffee',
  max_group_size: c.maxGroup, operating_hours: JSON.parse(hoursJson(c)),
});

const currentSql = `select row_to_json(x) as current from (select id, name, address, latitude, longitude, location_source, category, subcategory,
  max_group_size, operating_hours, google_place_id from brand_partners where id = '${BUSINESS_ID}') x`;

// Only fields still empty are filled: a value the owner already saved is never overwritten (each set = coalesce-style guard).
const updateSql = (c) => `update brand_partners set
    address = coalesce(address, ${q(TEST_ADDRESS)}),
    latitude = case when latitude is null and longitude is null then ${c.lat} else latitude end,
    longitude = case when latitude is null and longitude is null then ${c.lng} else longitude end,
    location_source = case when latitude is null and longitude is null then 'host_pin' else location_source end,
    subcategory = coalesce(subcategory, 'Coffee'),
    max_group_size = coalesce(max_group_size, ${c.maxGroup}),
    operating_hours = coalesce(operating_hours, ${q(hoursJson(c))}::jsonb)
  where id = '${BUSINESS_ID}'`;

const checkSql = (c) => `do $cc$
declare before_push bigint; before_rows jsonb; report jsonb;
begin
  select count(*) into before_push from public.push_outbox;
  ${updateSql(c)};
  report := jsonb_build_object(
    'after', (select row_to_json(x) from (select address, latitude, longitude, location_source, subcategory, max_group_size, operating_hours from brand_partners where id = '${BUSINESS_ID}') x),
    'offered_tags', (select to_jsonb(public.business_offered_tags('${BUSINESS_ID}'))),
    'pushes_queued_by_the_change', (select count(*) from public.push_outbox) - before_push);
  raise exception 'COASTAL_CHECK %', report::text;
end $cc$;`;

async function main() {
  const [mode = 'plan', ...flags] = process.argv.slice(2);
  const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
  console.log(`Target: ${L.target()}`);
  if (!['plan', 'check', 'apply'].includes(mode)) throw new Error(`unknown mode ${mode} (plan | check | apply)`);
  const c = config();
  const current = (await L.run(currentSql))[0]?.current;
  if (!current) throw new Error(`no business with id ${BUSINESS_ID}`);
  const code = crypto.createHash('sha256').update(JSON.stringify({ c, current, sql: updateSql(c) })).digest('hex').slice(0, 12);
  if (mode === 'plan') {
    console.log(JSON.stringify({ current, would_fill_only_empty_fields_with: changes(c) }, null, 2));
    console.log(`\nApproval code for exactly this plan (changes if the row or the settings change): ${code}`);
    return;
  }
  if (mode === 'check') {
    try {
      await L.run(checkSql(c));
      throw new Error('check did not roll back as expected');
    } catch (e) {
      const m = /COASTAL_CHECK (\{.*\})/s.exec(String(e.message || e));
      if (!m) throw e;
      console.log(JSON.stringify(JSON.parse(m[1]), null, 2));
      console.log('\nRolled back: nothing was written.');
    }
    return;
  }
  if (!L.isLocal()) {
    if (!flag('production')) throw new Error('this would write to PRODUCTION: refusing without --production (and only after the owner approved the plan)');
    const given = (flag('confirm') || '').split('=')[1];
    if (given !== code) throw new Error(`the plan's approval code is ${code}; --confirm=${given || '(none)'} does not match. Nothing written.`);
  }
  await L.run(updateSql(c));
  console.log(JSON.stringify((await L.run(currentSql))[0].current, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
