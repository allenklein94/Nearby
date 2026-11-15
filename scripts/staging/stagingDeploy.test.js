// deploy.js --target=staging (owner, 2026-11-15): goes only to the staging project, needs its own approval variable, and
// re-points production edge-function URLs inside the same transaction, before the ledger row and the commit.
const path = require('path');
const { main } = require('../migrations/deploy');
const B = require('./bootstrap');
const L = require('../migrations/ledger');

const REPO = path.resolve(__dirname, '../..');
const FILE = 'supabase/migrations/20270420_offer_screening_auto_retry.sql'; // names production's screen-business-content URL
const facts = L.migrationFacts(FILE, REPO);
const REF = 'abcdefghijklmnopqrst';
const baseEnv = { NEARBY_STAGING_REF: REF, NEARBY_STAGING_ACCESS_TOKEN: 'sbp_staging', NEARBY_APPROVAL_REF: 'owner, test', NEARBY_SESSION_ID: 'jest' };

function mockFetch() {
  const sent = [];
  let deployed = false;
  global.fetch = async (url, opts) => {
    const q = JSON.parse(opts.body).query;
    sent.push({ url, q });
    let rows;
    if (/to_regclass\('private.migration_ledger'\)/.test(q)) rows = [{ exists: true }];
    else if (/json_agg/.test(q)) rows = [{ rows: [{ version: '20270419', record_kind: 'deployed' }, ...(deployed ? [{ version: facts.version, file_sha256: facts.sha256 }] : [])] }];
    else { deployed = true; rows = []; }
    return { ok: true, text: async () => JSON.stringify(rows) };
  };
  return sent;
}

afterEach(() => { delete global.fetch; });

test('the committed file is approved by NEARBY_STAGING_APPROVAL; the sent transaction re-points before its ledger row', async () => {
  if (!facts.tracked || !facts.clean) return; // only meaningful on a committed, unchanged file
  const sent = mockFetch();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const code = await main([FILE, '--target=staging'], { ...baseEnv, NEARBY_STAGING_APPROVAL: `${facts.version}:${facts.sha256}` }, REPO);
  log.mockRestore();
  expect(code).toBe(0);
  expect(sent.every((s) => s.url === `https://api.supabase.com/v1/projects/${REF}/database/query`)).toBe(true);
  const tx = sent.find((s) => /^begin;/.test(s.q)).q;
  expect(tx).toContain(B.repointSql(REF));
  expect(tx.indexOf('do $repoint$')).toBeLessThan(tx.indexOf('insert into private.migration_ledger'));
  expect(tx.trim().endsWith('commit;')).toBe(true);
});

test('a production approval is never accepted for staging', async () => {
  mockFetch();
  await expect(main([FILE, '--target=staging'], { ...baseEnv, NEARBY_PROD_APPROVAL: `${facts.version}:${facts.sha256}` }, REPO)).rejects.toThrow(/use NEARBY_STAGING_APPROVAL/);
});

test('without its approval nothing is sent beyond the ledger reads', async () => {
  const sent = mockFetch();
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const code = await main([FILE, '--target=staging'], baseEnv, REPO);
  err.mockRestore(); log.mockRestore();
  expect(code).toBe(2);
  expect(sent.some((s) => /^begin;/.test(s.q))).toBe(false);
});

test('production deploys are unchanged: no re-point is added for --target=prod', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '../migrations/deploy.js'), 'utf8');
  expect(src).toMatch(/target === 'staging' && fileFacts\.exists/);
});
