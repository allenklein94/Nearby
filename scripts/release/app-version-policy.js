#!/usr/bin/env node
// Minimum supported app version (20270434): the ONE way to read or change the server's version policy. Each Supabase
// project has its own rows (private.app_version_policy), so staging and production can never share a setting; the target
// is always explicit (deploy.js's runner: --target=prod|staging|local, production's ref refused for staging).
//
//   node scripts/release/app-version-policy.js status --target=prod                                         READ-ONLY
//   node ... record-available --platform=ios --build=88 --channel=testflight --evidence="App Store Connect: 88 in group X, 2026-12-01" --target=...
//   node ... plan --platform=ios [--min=88|none] [--latest=88|none] [--url=itms-beta://...|none] [--enforce=on|off] --target=...
//   NEARBY_VERSION_APPROVAL=<code from plan> node ... set <same arguments> --target=prod
//   NEARBY_VERSION_APPROVAL=version-off node ... off --platform=ios|android|web|all --target=prod             EMERGENCY, instant
//
// Production: every change needs the code `plan` prints for exactly that change on exactly the current row (a code never
// outlives a change to the row, to 20270434 or to this file), except `off`, which takes the fixed code "version-off" so
// recovery is never slowed down. Staging / local: no code (isolated projects). Recording a build as available on
// production needs NEARBY_VERSION_APPROVAL=available:<platform>:<build>:<channel>.
// The database itself refuses enforcing (or announcing) a build that isn't recorded as available, and a store link to a
// store that doesn't carry it (20270434's trigger); this script adds the approval step and shows who it would affect.
// Enforcement in production is a SEPARATE owner approval from deploying 20270434 (owner, 2026-11-27).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = 'supabase/migrations/20270434_app_version_policy.sql';
const OFF_CODE = 'version-off';
const PLATFORMS = ['ios', 'android', 'web'];
const CHANNELS = ['testflight', 'staging_internal', 'app_store', 'google_play', 'website'];
const URL_RE = /^(https:\/\/|itms-beta:\/\/|itms-apps:\/\/|market:\/\/)[^\s']{3,500}$/;

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2]; else out._.push(a);
  }
  return out;
}

function intOrNone(v, name) {
  if (v === undefined) return undefined;
  if (v === 'none') return null;
  if (!/^\d{1,6}$/.test(v) || Number(v) < 1) throw new Error(`--${name} must be a build number (1-999999) or "none"`);
  return Number(v);
}

// The change, validated. undefined = leave as is.
function parseChange(args) {
  if (!PLATFORMS.includes(args.platform)) throw new Error(`--platform must be one of ${PLATFORMS.join(', ')}`);
  const change = { platform: args.platform };
  const min = intOrNone(args.min, 'min'); if (min !== undefined) change.min_supported_build = min;
  const latest = intOrNone(args.latest, 'latest'); if (latest !== undefined) change.latest_build = latest;
  if (args.url !== undefined) {
    if (args.url !== 'none' && !URL_RE.test(args.url)) throw new Error('--url must start with https://, itms-beta://, itms-apps:// or market:// (no spaces or quotes), or be "none"');
    change.update_url = args.url === 'none' ? null : args.url;
  }
  if (args.enforce !== undefined) {
    if (!['on', 'off'].includes(args.enforce)) throw new Error('--enforce must be on or off');
    change.enforced = args.enforce === 'on';
  }
  if (Object.keys(change).length === 1) throw new Error('nothing to change: give --min, --latest, --url and/or --enforce');
  return change;
}

const sqlValue = (v) => (v === null ? 'null' : typeof v === 'string' ? quote(v) : String(v));

function setSql(change, who) {
  const cols = Object.entries(change).filter(([k]) => k !== 'platform').map(([k, v]) => `${k} = ${sqlValue(v)}`);
  return `update private.app_version_policy set ${cols.join(', ')}, updated_by = ${quote(who)} where platform = ${quote(change.platform)}
  returning platform, min_supported_build, latest_build, update_url, enforced`;
}

function offSql(platform, who) {
  const where = platform === 'all' ? 'enforced' : `platform = ${quote(platform)} and enforced`;
  return `update private.app_version_policy set enforced = false, updated_by = ${quote(who)}, reason = 'emergency off' where ${where}
  returning platform, min_supported_build, enforced`;
}

function availableSql({ platform, build, channel, evidence }, who) {
  return `insert into private.app_build_availability (platform, build, channel, recorded_by, evidence)
  values (${quote(platform)}, ${build}, ${quote(channel)}, ${quote(who)}, ${quote(evidence)})
  on conflict (platform, build, channel) do nothing returning platform, build, channel`;
}

function parseAvailable(args) {
  if (!PLATFORMS.includes(args.platform)) throw new Error(`--platform must be one of ${PLATFORMS.join(', ')}`);
  const build = intOrNone(args.build, 'build');
  if (!build) throw new Error('--build is required');
  if (!CHANNELS.includes(args.channel)) throw new Error(`--channel must be one of ${CHANNELS.join(', ')}`);
  if (typeof args.evidence !== 'string' || args.evidence.trim().length < 3 || args.evidence.length > 500) {
    throw new Error('--evidence is required: where you saw the build available (e.g. "App Store Connect, TestFlight group Testers, 2026-12-01")');
  }
  if (args.platform === 'ios' && args.channel === 'google_play') throw new Error('google_play is not an iOS channel');
  if (args.platform === 'android' && ['testflight', 'app_store'].includes(args.channel)) throw new Error(`${args.channel} is not an Android channel`);
  return { platform: args.platform, build, channel: args.channel, evidence: args.evidence.trim() };
}

function fileHash(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
}

// Bound to: the target project, the current row, the exact change, 20270434 and this file.
function approvalCode({ ref, row, change, migrationHash = fileHash(MIGRATION), scriptHash = fileHash(path.relative(ROOT, __filename)) }) {
  const canon = (o) => JSON.stringify(o, Object.keys(o || {}).sort());
  return crypto.createHash('sha256')
    .update([ref || '', canon(row), canon(change), migrationHash, scriptHash].join('\n')).digest('hex').slice(0, 12);
}

const STATUS_SQL = `select jsonb_build_object(
  'installed', to_regclass('private.app_version_policy') is not null,
  'policy', case when to_regclass('private.app_version_policy') is null then null else (select jsonb_agg(to_jsonb(p) order by p.platform) from private.app_version_policy p) end,
  'available', case when to_regclass('private.app_build_availability') is null then null else (select jsonb_agg(jsonb_build_object('platform', a.platform, 'build', a.build, 'channel', a.channel, 'available_at', a.available_at) order by a.platform, a.build) from private.app_build_availability a) end,
  'recent_changes', case when to_regclass('private.app_version_policy_log') is null then null else (select jsonb_agg(x) from (select platform, changed_at, new_row ->> 'min_supported_build' as min, new_row ->> 'latest_build' as latest, new_row ->> 'enforced' as enforced, new_row ->> 'updated_by' as by from private.app_version_policy_log order by id desc limit 10) x) end,
  'hook', (select c from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%' limit 1)
) as status`;

// Live sign-in sessions by native build (the same reading deploy.js's release gate uses): who an enforced minimum would stop.
const SESSIONS_SQL = `select coalesce(substring(user_agent from '^Nearby/([0-9]+)')::int, -1) as build, count(*)::int as n
  from auth.sessions where (not_after is null or not_after > now()) and user_agent ~ '^Nearby/[0-9]+' group by 1 order by 1`;

function affected(sessions, min) {
  if (!min || !Array.isArray(sessions)) return 0;
  return sessions.filter((s) => s.build > 0 && s.build < min).reduce((a, s) => a + s.n, 0);
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const target = args.target;
  if (!['status', 'record-available', 'plan', 'set', 'off'].includes(cmd)) {
    throw new Error('usage: app-version-policy.js status|record-available|plan|set|off --target=prod|staging|local [...] (see the file header)');
  }
  const L = require('../migrations/ledger');
  const { name, run, ref } = L.runner(target, env);
  const who = (env.NEARBY_APPROVAL_REF || `${cmd} via app-version-policy.js`).slice(0, 200);
  const prod = target === 'prod';
  console.log(`target: ${name}`);

  const [{ status }] = await run(STATUS_SQL);
  if (!status.installed) throw new Error('20270434 is not installed on this target: nothing to read or change');
  if (cmd === 'status') { console.log(JSON.stringify(status, null, 2)); return status; }

  if (cmd === 'off') {
    if (![...PLATFORMS, 'all'].includes(args.platform)) throw new Error('--platform must be ios, android, web or all');
    if (prod && env.NEARBY_VERSION_APPROVAL !== OFF_CODE) throw new Error(`production: set NEARBY_VERSION_APPROVAL=${OFF_CODE} to switch enforcement off`);
    const rows = await run(offSql(args.platform, who));
    console.log(rows.length ? `enforcement OFF: ${rows.map((r) => r.platform).join(', ')} (takes effect on the next request)` : 'nothing was enforced');
    return rows;
  }

  if (cmd === 'record-available') {
    const a = parseAvailable(args);
    if (prod && env.NEARBY_VERSION_APPROVAL !== `available:${a.platform}:${a.build}:${a.channel}`) {
      throw new Error(`production: set NEARBY_VERSION_APPROVAL=available:${a.platform}:${a.build}:${a.channel} once you have SEEN build ${a.build} available on ${a.channel}`);
    }
    const rows = await run(availableSql(a, who));
    console.log(rows.length ? `recorded: ${a.platform} build ${a.build} available on ${a.channel}` : 'already recorded (unchanged)');
    return rows;
  }

  const change = parseChange(args);
  const row = (status.policy || []).find((p) => p.platform === change.platform);
  const { updated_at, updated_by, reason, ...current } = row || {};
  const next = { ...current, ...change };
  const code = approvalCode({ ref: ref || name, row: current, change });
  let sessions = [];
  try { sessions = await run(SESSIONS_SQL); } catch { sessions = null; }
  const stopped = next.enforced ? affected(sessions, next.min_supported_build) : 0;
  if (cmd === 'plan') {
    console.log(`current: ${JSON.stringify(current)}\nafter:   ${JSON.stringify(next)}`);
    if (next.enforced) console.log(`live sessions from ${change.platform === 'ios' ? 'iOS ' : ''}builds below ${next.min_supported_build}: ${sessions === null ? 'unknown (could not read)' : stopped} (their requests would be refused; they see the update screen only from build 88 on)`);
    console.log(`sql:\n${setSql(change, who)}`);
    console.log(prod ? `approval code: ${code}  (NEARBY_VERSION_APPROVAL=${code} ... set <same arguments> --target=prod)` : 'not production: `set` needs no code');
    return { code, next, stopped };
  }
  if (prod && env.NEARBY_VERSION_APPROVAL !== code) throw new Error('production: NEARBY_VERSION_APPROVAL must be the code `plan` printed for exactly this change on the current row (re-run plan)');
  const rows = await run(setSql(change, who));
  console.log(`updated: ${JSON.stringify(rows[0])}`);
  return rows;
}

if (require.main === module) {
  main().catch((e) => { console.error(`refused: ${e.message}`); process.exit(1); });
}

module.exports = {
  OFF_CODE, parseArgs, parseChange, parseAvailable, setSql, offSql, availableSql, approvalCode, affected, STATUS_SQL, main,
};
