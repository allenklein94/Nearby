// 2026-11-18: the hosted bootstrap hit the Management API's throttler (429) part-way. Only 429 is retried; resume continues
// after the last committed file, under the same approval code, never on an empty project or with a file outside the list.
const path = require('path');
const L = require('../migrations/ledger');
const B = require('./bootstrap');

const REF = 'hxsioiiulubavhogzipo';
const env = { NEARBY_STAGING_REF: REF, NEARBY_STAGING_ACCESS_TOKEN: 'sbp_test' };
const resp = (status, body) => ({ status, ok: status < 300, text: async () => body });

describe('staging runner retries', () => {
  test('429 is retried, then the result returned', async () => {
    const seq = [resp(429, 'ThrottlerException'), resp(429, 'ThrottlerException'), resp(201, '[{"x":1}]')];
    const f = jest.fn(async () => seq.shift());
    const r = L.stagingRunner(env, f, { retryWaitsMs: [1, 1, 1] });
    expect(await r.run('select 1')).toEqual([{ x: 1 }]);
    expect(f).toHaveBeenCalledTimes(3);
  });
  test('429 past the retry budget fails', async () => {
    const f = jest.fn(async () => resp(429, 'ThrottlerException'));
    const r = L.stagingRunner(env, f, { retryWaitsMs: [1, 1] });
    await expect(r.run('select 1')).rejects.toThrow(/429/);
    expect(f).toHaveBeenCalledTimes(3);
  });
  test('any other failure is never retried', async () => {
    for (const status of [400, 401, 403, 500, 502]) {
      const f = jest.fn(async () => resp(status, 'err'));
      const r = L.stagingRunner(env, f, { retryWaitsMs: [1, 1] });
      await expect(r.run('select 1')).rejects.toThrow(String(status));
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
});

describe('bootstrap resume', () => {
  const list = B.migrationList('20279999');
  const code = B.approvalCode(REF, list);
  const okEnv = { NEARBY_STAGING_BOOTSTRAP_APPROVAL: code, NEARBY_SESSION_ID: 't' };
  const runWith = (n) => jest.fn(async (sql) => (/count\(\*\)::int as n from pg_class/.test(sql) ? [{ n }] : []));
  test('refused on an empty project', async () => {
    await expect(B.apply({ run: runWith(0), ref: REF, through: '20279999', env: okEnv, resumeAfter: path.basename(list[0].rel), log: () => {} }))
      .rejects.toThrow(/empty/);
  });
  test('refused for a file outside the approved list', async () => {
    await expect(B.apply({ run: runWith(5), ref: REF, through: '20279999', env: okEnv, resumeAfter: 'nope.sql', log: () => {} }))
      .rejects.toThrow(/not in the approved list/);
  });
  test('refused with a wrong approval code', async () => {
    await expect(B.apply({ run: runWith(5), ref: REF, through: '20279999', env: { ...okEnv, NEARBY_STAGING_BOOTSTRAP_APPROVAL: 'x' }, resumeAfter: path.basename(list[0].rel), log: () => {} }))
      .rejects.toThrow(/approval/);
  });
  test('a fresh apply still refuses a non-empty project', async () => {
    await expect(B.apply({ run: runWith(5), ref: REF, through: '20279999', env: okEnv, log: () => {} })).rejects.toThrow(/not empty/);
  });
  test('resumes at the file after the named one', async () => {
    const sent = [];
    const run = jest.fn(async (sql) => { sent.push(sql); if (/as n from pg_class/.test(sql)) return [{ n: 5 }]; throw new Error('stop'); });
    const after = path.basename(list[143].rel);
    await expect(B.apply({ run, ref: REF, through: '20279999', env: okEnv, resumeAfter: after, log: () => {} })).rejects.toThrow(/FAILED at 20261006_block_clears_friendship\.sql/);
  });
});
