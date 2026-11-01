// Duplicate-photo detection activation (20270380) + its off/on switch + the backfill's near-duplicate step.
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp-compact');
const sw = require('./photo-detection-switch');
const { perceptualHashesOf } = require('./fingerprint-existing-photos');

const ROOT = path.resolve(__dirname, '../..');
const MIG = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270380_photo_detection_activation.sql'), 'utf8');
const T358 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270358_trust_safety_thresholds.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270380_photo_detection_activation.rollback.sql'), 'utf8');

describe('approved numbers are one set', () => {
  test('migration sets the owner-approved distances and refuses other exact rules', () => {
    expect(MIG).toMatch(new RegExp(`similar_photo_max_dhash = ${sw.APPROVED.dhash}, similar_photo_max_phash = ${sw.APPROVED.phash}`));
    expect(MIG).toMatch(new RegExp(`duplicate_photo_min_accounts is distinct from ${sw.APPROVED.minAccounts}`));
    expect(MIG).toMatch(new RegExp(`similar_name_min_similarity is distinct from ${sw.APPROVED.nameSimilarity}::real`));
    expect(T358).toMatch(new RegExp(`duplicate_photo_min_accounts = ${sw.APPROVED.minAccounts}, similar_name_min_similarity = ${sw.APPROVED.nameSimilarity}`));
    expect(sw.APPROVED).toEqual({ dhash: 10, phash: 10, minAccounts: 3, nameSimilarity: 0.5 });
  });
  test('migration judges existing photos once and never touches accounts', () => {
    expect(MIG).toMatch(/select private\.evaluate_existing_photo_signals\(\);\s*$/);
    const code = MIG.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/update (public\.)?profiles|suspend|restrict|_send_push|notifications|banned/i);
    expect(MIG).toMatch(/revoke all on function private\.evaluate_existing_photo_signals\(\) from public, anon, authenticated, service_role/);
  });
  test('rollback turns near-duplicates off and keeps every case', () => {
    expect(ROLLBACK).toMatch(/similar_photo_max_dhash = null, similar_photo_max_phash = null/);
    expect(ROLLBACK).not.toMatch(/delete from private\.account_review_cases/);
  });
});

describe('switch', () => {
  test('off leaves exact copies alone unless --all', () => {
    const update = (all) => sw.offSql(all).split(';')[0];
    expect(update(false)).not.toMatch(/duplicate_photo_min_accounts/);
    expect(sw.offSql(true)).toMatch(/duplicate_photo_min_accounts = null, similar_name_min_similarity = null/);
    for (const all of [false, true]) expect(sw.offSql(all)).not.toMatch(/account_review_cases\s+set|delete/i);
  });
  test('on restores exactly the approved numbers; the sweep is a separate statement', () => {
    expect(sw.onUpdate(false)).toMatch(/similar_photo_max_dhash = 10, similar_photo_max_phash = 10, updated_at/);
    expect(sw.onUpdate(false)).not.toMatch(/duplicate_photo_min_accounts/);
    expect(sw.onUpdate(true)).toMatch(/duplicate_photo_min_accounts = 3, similar_name_min_similarity = 0\.5/);
    expect(sw.onUpdate(true)).not.toMatch(/evaluate_existing/);
    expect(sw.SWEEP_SQL).toBe('select private.evaluate_existing_photo_signals() as result');
  });
  test('on commits the settings, then sweeps in a separate call (a concurrent upload is never missed)', async () => {
    const sent = [];
    jest.resetModules();
    jest.doMock('../migrations/ledger', () => ({ runner: () => ({ name: 'mock', run: async (sql) => { sent.push(sql); return [{ status: { activation_installed: true, settings: { min_accounts: 3, name_similarity: 0.5 } }, result: {} }]; } }) }));
    const fresh = require('./photo-detection-switch');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(await fresh.main(['on', '--target=local'], { NEARBY_PHOTO_DETECTION_APPROVAL: fresh.approvalCode(false) })).toBe(0);
    const writes = sent.filter((q) => q !== fresh.STATUS_SQL);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatch(/^update private\.account_signal_settings/);
    expect(writes[0]).not.toMatch(/evaluate_existing/);
    expect(writes[1]).toBe(fresh.SWEEP_SQL);
    sent.length = 0;
    expect(await fresh.main(['sweep', '--target=local'], {})).toBe(2);
    expect(sent.every((q) => q === fresh.STATUS_SQL)).toBe(true);
    expect(await fresh.main(['sweep', '--target=local'], { NEARBY_PHOTO_DETECTION_APPROVAL: fresh.SWEEP_CODE })).toBe(0);
    expect(sent.filter((q) => q !== fresh.STATUS_SQL)).toEqual([fresh.SWEEP_SQL]);
    log.mockRestore();
    jest.dontMock('../migrations/ledger');
  });
  test('on refuses before 20270380 and under other exact rules', () => {
    const live = { activation_installed: true, settings: { min_accounts: 3, name_similarity: 0.5 } };
    expect(sw.onRefusals(live, false)).toEqual([]);
    expect(sw.onRefusals({ ...live, activation_installed: false }, false)[0]).toMatch(/not deployed/);
    expect(sw.onRefusals({ ...live, settings: { min_accounts: null, name_similarity: null } }, false)[0]).toMatch(/on --all/);
    expect(sw.onRefusals({ ...live, settings: { min_accounts: null, name_similarity: null } }, true)).toEqual([]);
  });
  test('approval code binds the migration text and the scope', () => {
    expect(sw.approvalCode(false)).toMatch(/^photo-detection-on:[0-9a-f]{24}$/);
    expect(sw.approvalCode(true)).not.toBe(sw.approvalCode(false));
    expect(sw.approvalCode(false, `${MIG}\n-- edited`)).not.toBe(sw.approvalCode(false));
    expect(sw.approvalCode(false, MIG)).toBe(sw.approvalCode(false));
  });
  test('off and on refuse without their approval (nothing sent)', async () => {
    const sent = [];
    jest.resetModules();
    jest.doMock('../migrations/ledger', () => ({ runner: () => ({ name: 'mock', run: async (sql) => { sent.push(sql); return [{ status: { activation_installed: true, settings: { min_accounts: 3, name_similarity: 0.5 } } }]; } }) }));
    const fresh = require('./photo-detection-switch');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fresh.main(['off', '--target=local'], {})).toBe(2);
    expect(await fresh.main(['on', '--target=local'], { NEARBY_PHOTO_DETECTION_APPROVAL: 'wrong' })).toBe(2);
    expect(sent.every((s) => s === fresh.STATUS_SQL)).toBe(true);
    log.mockRestore(); err.mockRestore();
    jest.dontMock('../migrations/ledger');
  });
});

describe('backfill near-duplicate step', () => {
  const img = async () => {
    const im = new Jimp(64, 48);
    im.scan(0, 0, 64, 48, (x, y, i) => { im.bitmap.data[i] = x * 4; im.bitmap.data[i + 1] = y * 5; im.bitmap.data[i + 2] = (x * y) % 255; im.bitmap.data[i + 3] = 255; });
    return im.quality(90).getBufferAsync(Jimp.MIME_JPEG);
  };
  test('a JPEG gets the six hashes of the shared module', async () => {
    const bytes = new Uint8Array(await img());
    const got = await perceptualHashesOf(bytes);
    const { perceptualHashes } = await import('../../supabase/functions/_shared/perceptualHash.js');
    const expected = perceptualHashes((await Jimp.read(Buffer.from(bytes))).bitmap);
    expect(got).toEqual(expected);
    expect(got.map((h) => h.variant).sort()).toEqual(['crop80', 'crop80_mirror', 'crop90', 'crop90_mirror', 'full', 'mirror']);
  });
  test('non-JPEG or broken files get none (exact matching still applies)', async () => {
    expect(await perceptualHashesOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).toEqual([]);
    expect(await perceptualHashesOf(new Uint8Array([0xff, 0xd8, 0, 0, 0]))).toEqual([]);
  });
});
