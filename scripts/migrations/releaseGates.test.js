const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('./releaseGates');

const REPO = path.resolve(__dirname, '../..');
const ev = (lines) => ({ show: () => lines.join('\n'), dirty: () => false, srcChanged: () => false });
const NEXT = 'next: PASS build 88 @abc1234 through 20270433 (run)';
const REL = 'released: PASS build 87 @2a28c8e85 through 20270372 (run)';
const DIST = 'distribution: PASS build 88 2026-12-01 testflight-older: expired appstore-older: never-released (owner checked App Store Connect)';
const WEB = 'website: PASS build 88 deadbee exported + published';

describe('client floor', () => {
  test('nothing before 0373; build 88 from 0373 on, set by 0373 (and later floors)', () => {
    expect(G.effectiveFloor('20270372', REPO).build).toBeNull();
    expect(G.effectiveFloor('20270373', REPO)).toEqual({ build: 88, from: [20270373] });
    expect(G.effectiveFloor('20270381', REPO).build).toBe(88);
    expect(G.effectiveFloor('20270433', REPO).from).toEqual([20270373, 20270382, 20270407, 20270409, 20270422, 20270430]);
  });
  test('a migration header can declare its own floor', () => {
    expect(G.headerFloor('-- x\n-- release-gate: needs-build 90\nselect 1;')).toBe(90);
    expect(G.headerFloor('-- needs build 90 (prose only)')).toBeNull();
  });
});

describe('compatibility evidence', () => {
  test('Batch 1 passes with next + released runs that cover it', () => {
    expect(G.evidenceFailures('20270348', REPO, { build: null, from: [] }, ev([NEXT, REL]))).toEqual([]);
  });
  test('missing file, missing kinds, FAIL, duplicate, malformed: each refused', () => {
    expect(G.evidenceFailures('20270348', REPO, { build: null }, { show: () => null, dirty: () => false })[0]).toMatch(/no PRODUCT_AUDIT/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, ev([REL])).join()).toMatch(/no "next:"/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, ev([NEXT])).join()).toMatch(/no "released:"/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, ev(['next: FAIL build 88', REL])).join()).toMatch(/FAILED/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, ev([NEXT, NEXT, REL])).join()).toMatch(/2 times/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, ev(['next: PASS looked fine', REL])).join()).toMatch(/malformed/);
  });
  test('a run that stopped below the migration, or app source changed since, refuses', () => {
    const short = 'next: PASS build 88 @abc1234 through 20270360 (run)';
    expect(G.evidenceFailures('20270362', REPO, { build: null }, ev([short, REL])).join()).toMatch(/only through 20270360/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, { ...ev([NEXT, REL]), srcChanged: () => true }).join()).toMatch(/source changed/);
    expect(G.evidenceFailures('20270348', REPO, { build: null }, { ...ev([NEXT, REL]), dirty: () => true }).join()).toMatch(/uncommitted/);
  });
  test('released build proven only through 0372 is enough from 0373 on ONLY with the floor lines recorded', () => {
    const f = G.effectiveFloor('20270373', REPO);
    const without = G.evidenceFailures('20270373', REPO, f, ev([NEXT, REL])).join('\n');
    expect(without).toMatch(/distribution: PASS build 88/);
    expect(without).toMatch(/website: PASS build 88/);
    expect(without).not.toMatch(/released build 87 was proven only/);
    expect(G.evidenceFailures('20270373', REPO, f, ev([NEXT, REL, DIST, WEB]))).toEqual([]);
    expect(G.evidenceFailures('20270373', REPO, f, ev([NEXT.replace('build 88', 'build 87'), REL, DIST, WEB])).join()).toMatch(/next-build evidence is build 87/);
  });
  test('below the floor the released build must cover the migration', () => {
    const relShort = 'released: PASS build 87 @2a28c8e85 through 20270354 (run)';
    expect(G.evidenceFailures('20270362', REPO, { build: null }, ev([NEXT, relShort])).join()).toMatch(/released build 87 was proven only through 20270354/);
  });
  test('the committed evidence file: Batches 1-5 pass, 0373 refused until distribution + website are recorded', () => {
    const real = { srcChanged: () => false };
    expect(G.evidenceFailures('20270372', REPO, G.effectiveFloor('20270372', REPO), real)).toEqual([]);
    expect(G.evidenceFailures('20270373', REPO, G.effectiveFloor('20270373', REPO), real).join()).toMatch(/distribution/);
  });
});

describe('live sessions (client floor)', () => {
  const f = { build: 88, from: [20270373] };
  test('an older app build signed in, or an unknown client, refuses; build 88+ and browsers pass', () => {
    expect(G.sessionFailures([{ kind: 'app', build: 88, n: 2 }, { kind: 'browser', build: -1, n: 5 }], f)).toEqual([]);
    expect(G.sessionFailures([{ kind: 'app', build: 87, n: 1 }], f)[0]).toMatch(/1 live session\(s\) from app build\(s\) 87/);
    expect(G.sessionFailures([{ kind: 'other', build: -1, n: 1 }], f)[0]).toMatch(/unrecognised client/);
    expect(G.sessionFailures([{ kind: 'app', build: 87, n: 1 }], { build: null })).toEqual([]);
  });
  test('the session read is one read-only SELECT', () => {
    expect(G.SESSIONS_SQL.trim()).toMatch(/^select /i);
    expect(G.SESSIONS_SQL).not.toMatch(/;\s*\S|insert|update|delete|drop|alter/i);
  });
});

describe('backup', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  const put = (d, f, o) => fs.writeFileSync(path.join(d, f), JSON.stringify(o));
  const now = Date.parse('2026-12-01T12:00:00Z');
  test('none, too old, or not encrypted: refused; fresh + encrypted: passes', () => {
    const d = dir();
    expect(G.backupFailures(d, now)[0]).toMatch(/no verified backup/);
    put(d, 'verified-20261130T000000Z.json', { ts: '20261130T000000Z', verified_at: '2026-11-30T00:00:00Z' });
    expect(G.backupFailures(d, now).join()).toMatch(/36 h old/);
    put(d, 'verified-20261201T080000Z.json', { ts: '20261201T080000Z', verified_at: '2026-12-01T08:00:00Z' });
    expect(G.backupFailures(d, now)).toEqual(['release gate: backup 20261201T080000Z has no encrypted copy (bash scripts/backup/encrypt-backup.sh)']);
    put(d, 'encrypted-20261201T080000Z.json', { ts: '20261201T080000Z' });
    expect(G.backupFailures(d, now)).toEqual([]);
  });
});

describe('wired into deploy.js for production only', () => {
  test('deploy.js calls releaseGateFailures for prod; a check only warns', () => {
    const src = fs.readFileSync(path.join(__dirname, 'deploy.js'), 'utf8');
    expect(src).toMatch(/if \(target === 'prod'\) \{\s*const gates = await require\('\.\/releaseGates'\)\.releaseGateFailures/);
    expect(src).toMatch(/if \(check\) gates\.forEach[\s\S]*else refusals\.push\(\.\.\.gates\)/);
  });
  test('a failed session read refuses (fails closed)', async () => {
    const r = await G.releaseGateFailures({ facts: { version: '20270373' }, run: async () => { throw new Error('down'); }, repoRoot: REPO, backupDir: '/nonexistent', evidenceOpts: ev([NEXT, REL]) });
    expect(r.join('\n')).toMatch(/could not read live sessions/);
  });
});

// Rule 6 (a path to production for every migration): every pending migration has a rollback script and a packet row.
describe('every migration after production has a deployment + recovery path', () => {
  const migs = fs.readdirSync(path.join(REPO, 'supabase/migrations')).filter((f) => /^\d{8}_.*\.sql$/.test(f) && f.slice(0, 8) > '20270347');
  const packets = fs.readFileSync(path.join(REPO, 'PRODUCT_AUDIT/MIGRATION_APPROVAL_PACKETS_0348-0433.md'), 'utf8');
  test.each(migs)('%s', (f) => {
    const v = f.replace(/\.sql$/, '');
    expect(fs.existsSync(path.join(REPO, 'scripts/rollback', `${v}.rollback.sql`))).toBe(true);
    expect(packets.includes(`| ${v} |`)).toBe(true);
  });
});

describe('app source = code + config + shipped dependencies (not tests, not npm scripts)', () => {
  // Not pinned to a recorded evidence commit: a branch that changes app code (e.g. 20270434's update gate) makes that
  // evidence stale ON PURPOSE (deploy.js then refuses until release-compat is re-run), which is the gate, not this test.
  test('HEAD matches itself; build 87 source does not', () => {
    expect(G.appSourceChanged(REPO, 'HEAD')).toBe(false);
    expect(G.appSourceChanged(REPO, '2a28c8e85')).toBe(true);
  });
});

describe('policy with the change (rule 8)', () => {
  const pub = (html) => ({ showPublished: () => html });
  test('a migration with no new processing needs nothing', () => {
    expect(G.privacyFailures('20270348', REPO, pub(null))).toEqual([]);
  });
  test('0351 is refused until its marked sentence is on published main', () => {
    expect(G.privacyFailures('20270351', REPO, pub('<p>old policy</p>'))[0]).toMatch(/publish its Privacy Policy sentence first/);
    expect(G.privacyFailures('20270351', REPO, pub(null))).toHaveLength(1);
    expect(G.privacyFailures('20270351', REPO, pub('<p>If suspended... <!-- nearby-processing: 20270351 --></p>'))).toEqual([]);
  });
  test('another version\'s marker does not count', () => {
    expect(G.privacyFailures('20270355', REPO, pub('<!-- nearby-processing: 20270351 -->'))).toHaveLength(1);
  });
  test('the published policy today carries no marker, so every listed migration would be refused', () => {
    const live = fs.readFileSync(path.join(REPO, 'docs/privacy.html'), 'utf8');
    for (const v of Object.keys(G.PRIVACY_REQUIRED)) expect(G.privacyFailures(v, REPO, pub(live))).toHaveLength(1);
  });
  test('every listed version is a migration on this branch', () => {
    const files = fs.readdirSync(path.join(REPO, 'supabase/migrations'));
    for (const v of Object.keys(G.PRIVACY_REQUIRED)) expect(files.some((f) => f.startsWith(`${v}_`))).toBe(true);
  });
  test('a header can declare it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-'));
    fs.mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'supabase/migrations/20279999_x.sql'), '-- release-gate: privacy\nselect 1;');
    expect(G.privacyRequired('20279999', dir)).toBe('declared in the migration header');
  });
});

describe('returning older installs (signed out, dormant, expired session)', () => {
  test('a distribution line that only says "checked" is refused at 0373', () => {
    const f = G.distributionFailures('distribution: PASS build 88 2026-12-01 App Store Connect checked', 88, '20270373');
    expect(f).toHaveLength(2);
  });
  test('older TestFlight builds still available = refused', () => {
    expect(G.distributionFailures('distribution: PASS build 88 x testflight-older: available appstore-older: never-released', 88, '20270373')).toHaveLength(1);
  });
  test('expired + never released passes', () => {
    expect(G.distributionFailures(DIST, 88, '20270373')).toEqual([]);
  });
  test('wired into the evidence gate', () => {
    const f = G.evidenceFailures('20270373', REPO, { build: 88, from: [20270373] }, ev([NEXT, REL, 'distribution: PASS build 88 2026-12-01 App Store Connect checked', WEB]));
    expect(f.some((x) => /testflight-older: expired/.test(x))).toBe(true);
  });
});

describe('server-side minimum version (20270434) in place of "older builds can\'t launch"', () => {
  const f = { build: 88, from: [20270373] };
  const row = (platform, min, enforced, newest, strict = true) => ({ platform, min_supported_build: min, enforced, newest_available: newest, strict });
  const ANDROID_NONE = 'distribution: PASS build 88 2026-12-01 android: never-released';
  test('covered only when iOS is enforced at >= the floor with that build available, and Android enforced or never released', () => {
    expect(G.serverFloorCovers([row('ios', 88, true, 88), row('android', null, false, null)], f, ANDROID_NONE)).toBe(true);
    expect(G.serverFloorCovers([row('ios', 88, true, 88), row('android', 88, true, 88)], f, '')).toBe(true);
    expect(G.serverFloorCovers([row('ios', 88, true, 88), row('android', null, false, null)], f, '')).toBe(false);
    expect(G.serverFloorCovers([row('ios', 88, false, 88)], f, ANDROID_NONE)).toBe(false);
    expect(G.serverFloorCovers([row('ios', 87, true, 88)], f, ANDROID_NONE)).toBe(false);
    expect(G.serverFloorCovers([row('ios', 88, true, 87)], f, ANDROID_NONE)).toBe(false);
    expect(G.serverFloorCovers([], f, ANDROID_NONE)).toBe(false);
    expect(G.serverFloorCovers(null, f, ANDROID_NONE)).toBe(false);
    expect(G.serverFloorCovers([row('ios', 88, true, 88)], { build: null }, ANDROID_NONE)).toBe(false);
  });
  test('covered: older live sessions and a not-yet-expired TestFlight build no longer block; availability + website still do', () => {
    expect(G.sessionFailures([{ kind: 'app', build: 87, n: 1 }], f, { serverFloor: true })).toEqual([]);
    expect(G.sessionFailures([{ kind: 'other', build: -1, n: 1 }], f, { serverFloor: true })[0]).toMatch(/unrecognised/);
    const weak = 'distribution: PASS build 88 2026-12-01 android: never-released';
    const NEXT434 = 'next: PASS build 88 @abc1234 through 20270434 (run)';
    expect(G.evidenceFailures('20270373', REPO, f, { ...ev([NEXT434, REL, weak, WEB]), serverFloor: true })).toEqual([]);
    expect(G.evidenceFailures('20270373', REPO, f, ev([NEXT434, REL, weak, WEB])).join()).toMatch(/testflight-older: expired/);
    expect(G.evidenceFailures('20270373', REPO, f, { ...ev([NEXT434, REL, WEB]), serverFloor: true }).join()).toMatch(/distribution: PASS build 88/);
    expect(G.evidenceFailures('20270373', REPO, f, { ...ev([NEXT434, REL, weak]), serverFloor: true }).join()).toMatch(/website/);
  });
  test('the live read: no policy table (before 0434) or a failed read = not covered (the stricter rule applies)', async () => {
    expect(await G.readServerFloor(async () => [{ present: false }], f, REPO)).toEqual({ covered: false });
    expect(await G.readServerFloor(async () => { throw new Error('x'); }, f, REPO)).toEqual({ covered: false });
    const run = async (sql) => (sql === G.POLICY_PRESENT_SQL ? [{ present: true }]
      : [row('ios', 90, true, 90), row('android', null, false, null)]);
    expect((await G.readServerFloor(run, f, REPO, { show: () => ANDROID_NONE })).covered).toBe(true);
    expect((await G.readServerFloor(run, f, REPO, { show: () => '' })).covered).toBe(false);
    expect(await G.readServerFloor(run, { build: null }, REPO)).toEqual({ covered: false });
  });
  test('strict mode OFF = not covered (an unidentified client could still reach the database)', () => {
    expect(G.serverFloorCovers([row('ios', 88, true, 88, false), row('android', null, false, null, false)], f, ANDROID_NONE)).toBe(false);
    expect(G.serverFloorCovers([row('ios', 88, true, 88, true), row('android', null, false, null, true)], f, ANDROID_NONE)).toBe(true);
  });
  test('a migration touching Auth, Realtime, Storage reads/buckets or a static page endpoint is never covered', async () => {
    expect(G.serverFloorGaps('create policy x on public.t for select using (true);')).toEqual([]);
    expect(G.serverFloorGaps('-- mentions auth.users and supabase_realtime only in a comment\nselect 1;')).toEqual([]);
    expect(G.serverFloorGaps('create trigger t after insert on auth.users for each row execute function f();').join()).toMatch(/Auth/);
    expect(G.serverFloorGaps('create function public.hook_before_user_created(e jsonb) returns jsonb as $$ select e $$ language sql;').join()).toMatch(/Auth/);
    expect(G.serverFloorGaps('alter publication supabase_realtime add table public.t;').join()).toMatch(/Realtime/);
    expect(G.serverFloorGaps("update storage.buckets set public = false where id = 'x';").join()).toMatch(/buckets/);
    expect(G.serverFloorGaps('create policy r on storage.objects for select to authenticated using (true);').join()).toMatch(/Storage reads/);
    expect(G.serverFloorGaps('create policy r on storage.objects using (true);').join()).toMatch(/Storage reads/);
    expect(G.serverFloorGaps('create policy w on storage.objects for insert to authenticated with check (true);')).toEqual([]);
    expect(G.serverFloorGaps('drop policy if exists r on storage.objects;')).toEqual([]);
    expect(G.serverFloorGaps('create or replace function public.get_public_shared_night(t text) returns jsonb as $$ select null $$ language sql;').join()).toMatch(/static GitHub Pages/);
    const run = async (sql) => (sql === G.POLICY_PRESENT_SQL ? [{ present: true }] : [row('ios', 90, true, 90), row('android', null, false, null)]);
    const r = await G.readServerFloor(run, f, REPO, { show: () => ANDROID_NONE }, 'alter publication supabase_realtime add table public.t;');
    expect(r.covered).toBe(false);
    expect(r.gaps.join()).toMatch(/Realtime/);
  });
  test('every static page endpoint really is what docs/*.html calls, and 0434 exempts exactly those', () => {
    const fs = require('fs'); const path = require('path');
    const docs = ['invite', 'occasion-invite', 'shared-night', 'track', 'business'].map((n) => fs.readFileSync(path.join(REPO, 'docs', `${n}.html`), 'utf8')).join('\n');
    const mig = fs.readFileSync(path.join(REPO, 'supabase/migrations/20270434_app_version_policy.sql'), 'utf8');
    G.STATIC_PAGE_ENDPOINTS.forEach((n) => { expect(docs).toContain(n); expect(mig).toContain(n === 'business_acquisition_events' ? `'/${n}'` : `'/rpc/${n}'`); });
    const called = new Set([...docs.matchAll(/rest\/v1\/rpc\/([a-z_]+)/g)].map((m) => m[1]).concat([...docs.matchAll(/callRpc\('([a-z_]+)'/g)].map((m) => m[1]))
      .concat([...docs.matchAll(/rest\/v1\/([a-z_]+)/g)].map((m) => m[1]).filter((n) => n !== 'rpc')));
    called.forEach((n) => expect(G.STATIC_PAGE_ENDPOINTS).toContain(n));
  });
});
