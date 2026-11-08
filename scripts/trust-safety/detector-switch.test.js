// The detector switch: nothing turns these on but this script, and `on` refuses until every gate is met.
const fs = require('fs');
const path = require('path');
const sw = require('./detector-switch');

const ROOT = path.resolve(__dirname, '../..');
const ready = { installed: true, secret_ok: true, client_access: false, purge_job: true };
const GOOD_POLICY = '<!-- detector-disclosure:shared-device --><!-- detector-disclosure:shared-text -->';

describe('nothing else turns them on', () => {
  const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'));
  test('no migration sets a detector number', () => {
    const setters = migrations.filter((f) => /(shared_device_min_accounts|shared_text_min_accounts)\s*=\s*\d|shared_device_suspended_enabled\s*=\s*true/.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')));
    expect(setters).toEqual([]);
  });
  test('the numbers are the owner\'s recorded preferences', () => {
    expect(sw.DETECTORS.device.numbers).toEqual({ shared_device_min_accounts: 4, shared_device_suspended_enabled: true });
    expect(sw.DETECTORS.text.numbers).toEqual({ shared_text_min_accounts: 5 });
    expect(sw.onUpdate('device')).toMatch(/shared_device_min_accounts = 4, shared_device_suspended_enabled = true/);
    expect(sw.offUpdate('all')).toMatch(/shared_device_min_accounts = null, shared_device_suspended_enabled = false, shared_text_min_accounts = null/);
  });
});

describe('`on` refuses until every gate is met', () => {
  test.each(['device', 'text'])('%s: ready + disclosed = nothing to refuse', (d) => {
    expect(sw.onRefusals(d, { [d]: ready }, GOOD_POLICY)).toEqual([]);
  });
  test.each([
    ['installed', false, /not deployed/], ['secret_ok', false, /secret/], ['client_access', true, /client or service role/], ['purge_job', false, /retention job/],
  ])('%s = %s refuses', (k, v, re) => {
    expect(sw.onRefusals('text', { text: { ...ready, [k]: v } }, GOOD_POLICY).join()).toMatch(re);
  });
  test('no disclosure in the published policy refuses', () => {
    expect(sw.onRefusals('text', { text: ready }, '<p>nothing</p>').join()).toMatch(/Privacy Policy/);
  });
  test('the sentence promising the token is only for notifications refuses the device detector', () => {
    expect(sw.onRefusals('device', { device: ready }, `${GOOD_POLICY} used solely to deliver notifications`).join()).toMatch(/solely/);
  });
  test('today\'s published policy refuses both', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'docs/privacy.html'), 'utf8');
    expect(sw.onRefusals('device', { device: ready }, policy).length).toBeGreaterThan(0);
    expect(sw.onRefusals('text', { text: ready }, policy).length).toBeGreaterThan(0);
  });
  test('a code is bound to the numbers and the migration text', () => {
    expect(sw.approvalCode('text', 'a')).not.toBe(sw.approvalCode('text', 'b'));
    expect(sw.approvalCode('text', 'a')).not.toBe(sw.approvalCode('device', 'a'));
  });
});

describe('main', () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const sent = [];
  const status = { device: ready, text: ready };
  jest.doMock('../migrations/ledger', () => ({ runner: () => ({ name: 'test', run: async (sql) => { sent.push(sql); return [{ status, result: {}, done: 1 }]; } }) }));
  beforeEach(() => { sent.length = 0; });
  const writes = () => sent.filter((s) => /update private\.account_signal_settings|backfill/.test(s));
  test('status writes nothing', async () => { expect(await sw.main(['status', '--target=local'], {})).toBe(0); expect(writes()).toEqual([]); });
  test('on without the code sends nothing', async () => { expect(await sw.main(['on', '--detector=text', '--target=local'], {})).toBe(2); expect(writes()).toEqual([]); });
  test('on with the code but no published disclosure sends nothing', async () => {
    expect(await sw.main(['on', '--detector=text', '--target=local'], { NEARBY_DETECTOR_APPROVAL: sw.approvalCode('text') })).toBe(2);
    expect(writes()).toEqual([]);
  });
  test('off needs its code, then changes only the settings', async () => {
    expect(await sw.main(['off', '--detector=all', '--target=local'], {})).toBe(2);
    expect(writes()).toEqual([]);
    expect(await sw.main(['off', '--detector=all', '--target=local'], { NEARBY_DETECTOR_APPROVAL: sw.OFF_CODE })).toBe(0);
    expect(writes().length).toBe(1);
    expect(writes()[0]).toMatch(/shared_text_min_accounts = null/);
  });
});
