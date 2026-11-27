// Owner script for the server's version policy (20270434): argument checks, SQL shape, approval binding, emergency off.
const P = require('./app-version-policy');

const runFor = (status, extra = {}) => {
  const calls = [];
  const run = async (sql) => {
    calls.push(sql);
    if (sql === P.STATUS_SQL) return [{ status }];
    if (/from auth\.sessions/.test(sql)) return extra.sessions || [];
    return extra.rows || [{ platform: 'ios' }];
  };
  return { run, calls };
};
const STATUS = {
  installed: true,
  policy: [{ platform: 'ios', min_supported_build: null, latest_build: null, update_url: null, enforced: false, updated_at: 'x', updated_by: 'y', reason: null }],
};
jest.mock('../migrations/ledger', () => ({ runner: jest.fn() }));
const L = require('../migrations/ledger');
const use = (r, target = 'prod') => L.runner.mockImplementation((t) => {
  if (t !== target) throw new Error('wrong target');
  return { name: t, ref: `${t}-ref`, run: r.run };
});

describe('arguments', () => {
  test('a change needs a platform and something to change; values are checked', () => {
    expect(() => P.parseChange({ platform: 'ios' })).toThrow(/nothing to change/);
    expect(() => P.parseChange({ platform: 'mac', min: '88' })).toThrow(/platform/);
    expect(() => P.parseChange({ platform: 'ios', min: '0' })).toThrow(/build number/);
    expect(() => P.parseChange({ platform: 'ios', min: '88x' })).toThrow(/build number/);
    expect(() => P.parseChange({ platform: 'ios', url: 'javascript:alert(1)' })).toThrow(/--url/);
    expect(() => P.parseChange({ platform: 'ios', url: "https://x.y/'; drop table x; --" })).toThrow(/--url/);
    expect(() => P.parseChange({ platform: 'ios', enforce: 'yes' })).toThrow(/on or off/);
    expect(P.parseChange({ platform: 'ios', min: '88', latest: 'none', enforce: 'on', url: 'itms-beta://testflight.apple.com/v1/app/1' }))
      .toEqual({ platform: 'ios', min_supported_build: 88, latest_build: null, enforced: true, update_url: 'itms-beta://testflight.apple.com/v1/app/1' });
  });
  test('availability needs a real channel for the platform and the evidence', () => {
    expect(() => P.parseAvailable({ platform: 'ios', build: '88', channel: 'testflight' })).toThrow(/evidence/);
    expect(() => P.parseAvailable({ platform: 'ios', build: '88', channel: 'google_play', evidence: 'seen' })).toThrow(/not an iOS channel/);
    expect(() => P.parseAvailable({ platform: 'android', build: '88', channel: 'testflight', evidence: 'seen' })).toThrow(/not an Android/);
    expect(P.availableSql(P.parseAvailable({ platform: 'ios', build: '88', channel: 'testflight', evidence: "group 'A'" }), 'owner'))
      .toMatch(/'group ''A'''/);
  });
});

describe('approval codes', () => {
  const base = { ref: 'r', row: { platform: 'ios', enforced: false }, change: { platform: 'ios', min_supported_build: 88, enforced: true }, migrationHash: 'm', scriptHash: 's' };
  test('the code changes with the target, the current row, the change, the migration and this script', () => {
    const c = P.approvalCode(base);
    expect(P.approvalCode(base)).toBe(c);
    expect(P.approvalCode({ ...base, ref: 'other' })).not.toBe(c);
    expect(P.approvalCode({ ...base, row: { platform: 'ios', enforced: true } })).not.toBe(c);
    expect(P.approvalCode({ ...base, change: { ...base.change, min_supported_build: 89 } })).not.toBe(c);
    expect(P.approvalCode({ ...base, migrationHash: 'm2' })).not.toBe(c);
    expect(P.approvalCode({ ...base, scriptHash: 's2' })).not.toBe(c);
  });
});

describe('main', () => {
  test('production set without the plan code is refused and sends no change', async () => {
    const r = runFor(STATUS); use(r);
    await expect(P.main(['set', '--platform=ios', '--min=88', '--enforce=on', '--target=prod'], { NEARBY_VERSION_APPROVAL: 'wrong' })).rejects.toThrow(/code `plan` printed/);
    expect(r.calls.some((s) => /^update/.test(s))).toBe(false);
  });
  test('plan prints a code that set then accepts, and counts who would be stopped', async () => {
    const r = runFor(STATUS, { sessions: [{ build: 87, n: 2 }, { build: 88, n: 1 }] }); use(r);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const plan = await P.main(['plan', '--platform=ios', '--min=88', '--enforce=on', '--target=prod'], {});
    expect(plan.stopped).toBe(2);
    await P.main(['set', '--platform=ios', '--min=88', '--enforce=on', '--target=prod'], { NEARBY_VERSION_APPROVAL: plan.code });
    expect(r.calls.filter((s) => /^update private\.app_version_policy set min_supported_build = 88, enforced = true/.test(s))).toHaveLength(1);
    log.mockRestore();
  });
  test('emergency off: fixed code on production, every enforced platform with "all"', async () => {
    const r = runFor(STATUS); use(r);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(P.main(['off', '--platform=ios', '--target=prod'], {})).rejects.toThrow(/version-off/);
    await P.main(['off', '--platform=all', '--target=prod'], { NEARBY_VERSION_APPROVAL: 'version-off' });
    expect(r.calls.find((s) => /^update/.test(s))).toMatch(/set enforced = false.* where enforced/s);
    log.mockRestore();
  });
  test('staging needs no code; a target without 20270434 is refused', async () => {
    const r = runFor(STATUS); use(r, 'staging');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await P.main(['set', '--platform=ios', '--latest=88', '--target=staging'], {});
    expect(r.calls.some((s) => /latest_build = 88/.test(s))).toBe(true);
    const none = runFor({ installed: false }); use(none, 'staging');
    await expect(P.main(['status', '--target=staging'], {})).rejects.toThrow(/not installed/);
    log.mockRestore();
  });
  test('production availability needs its own code', async () => {
    const r = runFor(STATUS); use(r);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const args = ['record-available', '--platform=ios', '--build=88', '--channel=testflight', '--evidence=App Store Connect', '--target=prod'];
    await expect(P.main(args, {})).rejects.toThrow(/available:ios:88:testflight/);
    await P.main(args, { NEARBY_VERSION_APPROVAL: 'available:ios:88:testflight' });
    expect(r.calls.some((s) => /insert into private\.app_build_availability/.test(s))).toBe(true);
    log.mockRestore();
  });
  test('affected counts only native builds below the minimum', () => {
    expect(P.affected([{ build: -1, n: 5 }, { build: 86, n: 1 }, { build: 87, n: 2 }, { build: 88, n: 3 }], 88)).toBe(3);
    expect(P.affected(null, 88)).toBe(0);
  });
});

describe('strict mode (refuse unidentified clients)', () => {
  const S = { ...STATUS, strict: { id: true, refuse_unidentified: false, updated_at: 'x', updated_by: 'y', reason: null } };
  test('production: without a code it only plans; the printed code applies exactly that change', async () => {
    const r = runFor(S); use(r);
    const plan = await P.main(['strict', '--strict=on', '--target=prod'], {});
    expect(r.calls.some((c) => /update private\.app_version_settings/.test(c))).toBe(false);
    await expect(P.main(['strict', '--strict=on', '--target=prod'], { NEARBY_VERSION_APPROVAL: 'wrong' })).rejects.toThrow(/code/);
    await expect(P.main(['strict', '--strict=on', '--target=prod'], { NEARBY_VERSION_APPROVAL: P.OFF_CODE })).rejects.toThrow(/code/);
    const r2 = runFor(S); use(r2);
    await P.main(['strict', '--strict=on', '--target=prod'], { NEARBY_VERSION_APPROVAL: plan.code });
    expect(r2.calls.some((c) => /refuse_unidentified = true/.test(c))).toBe(true);
  });
  test('switching strict OFF also takes the fixed emergency code; off --platform=all clears strict mode too', async () => {
    const on = { ...S, strict: { ...S.strict, refuse_unidentified: true } };
    const r = runFor(on); use(r);
    await P.main(['strict', '--strict=off', '--target=prod'], { NEARBY_VERSION_APPROVAL: P.OFF_CODE });
    expect(r.calls.some((c) => /refuse_unidentified = false/.test(c))).toBe(true);
    const r2 = runFor(on); use(r2);
    await P.main(['off', '--platform=all', '--target=prod'], { NEARBY_VERSION_APPROVAL: P.OFF_CODE });
    expect(r2.calls.some((c) => /refuse_unidentified = false/.test(c))).toBe(true);
    const r3 = runFor(on); use(r3);
    await P.main(['off', '--platform=ios', '--target=prod'], { NEARBY_VERSION_APPROVAL: P.OFF_CODE });
    expect(r3.calls.some((c) => /refuse_unidentified/.test(c))).toBe(false);
  });
  test('staging needs no code; bad values refused', async () => {
    const r = runFor(S); use(r, 'staging');
    await P.main(['strict', '--strict=on', '--target=staging'], {});
    expect(r.calls.some((c) => /refuse_unidentified = true/.test(c))).toBe(true);
    use(runFor(S), 'staging');
    await expect(P.main(['strict', '--strict=maybe', '--target=staging'], {})).rejects.toThrow(/on or off/);
  });
});
