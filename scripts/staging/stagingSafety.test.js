// Staging deployment target (owner approval B, 2026-11-15). Every network call is mocked: no project is ever contacted.
// Proves: staging commands reach only the staging ref; production's ref is refused in every form; production commands refuse
// any staging setting; approvals never cross environments; a staging deploy re-points production URLs inside its own
// transaction; bootstrap re-points inside EVERY migration's transaction; the preflight refuses each real-world channel.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../migrations/ledger');
const { main: deployMain } = require('../migrations/deploy');
const B = require('./bootstrap');
const P = require('./preflight');
const { stagingRef, PRODUCTION_REF } = require('../lib/stagingTarget');

const REPO = path.resolve(__dirname, '../..');
const REF = 'abcdefghijklmnopqrst';
const STAGING_ENV = { NEARBY_STAGING_REF: REF, NEARBY_STAGING_ACCESS_TOKEN: 'sbp_staging_only' };
const FILE = 'supabase/migrations/20270347_push_tokens_server_only.sql';
const facts = L.migrationFacts(FILE, REPO);
test('the fixture migration is a committed, unchanged file (the deploy tests below need it)', () => expect([facts.exists, facts.tracked]).toEqual([true, true]));

const tmpFile = (obj) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stg-')), 'staging.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
};
const quiet = () => {
  const a = jest.spyOn(console, 'log').mockImplementation(() => {});
  const b = jest.spyOn(console, 'error').mockImplementation(() => {});
  return () => { a.mockRestore(); b.mockRestore(); };
};

describe('stagingRef: the one way to name the staging project', () => {
  test('from env, or from the private file (url must match its ref)', () => {
    expect(stagingRef({ env: { NEARBY_STAGING_REF: REF } }).ref).toBe(REF);
    expect(stagingRef({ env: {}, file: tmpFile({ ref: REF, url: `https://${REF}.supabase.co` }) }).ref).toBe(REF);
  });
  test.each([
    ['production ref in env', { env: { NEARBY_STAGING_REF: PRODUCTION_REF } }, /PRODUCTION/],
    ['production ref inside a longer value', { env: { NEARBY_STAGING_REF: `x${PRODUCTION_REF}` } }, /PRODUCTION/],
    ['malformed ref', { env: { NEARBY_STAGING_REF: 'short' } }, /20-character/],
    ['file names production', { env: {}, file: tmpFile({ ref: PRODUCTION_REF }) }, /PRODUCTION/],
    ['file url is production', { env: {}, file: tmpFile({ ref: REF, url: `https://${PRODUCTION_REF}.supabase.co` }) }, /PRODUCTION/],
    ['file url != its ref', { env: {}, file: tmpFile({ ref: REF, url: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }) }, /does not match/],
    ['no ref anywhere', { env: {}, file: '/nonexistent/staging.json' }, /no staging project/],
  ])('refused: %s', (_, args, msg) => expect(() => stagingRef(args)).toThrow(msg));
});

describe('runners', () => {
  test('staging: only the staging URL, only the staging token', async () => {
    const calls = [];
    const r = L.stagingRunner(STAGING_ENV, async (url, opts) => { calls.push([url, opts.headers.Authorization]); return { ok: true, text: async () => '[]' }; });
    await r.run('select 1');
    expect(calls).toEqual([[`https://api.supabase.com/v1/projects/${REF}/database/query`, 'Bearer sbp_staging_only']]);
  });
  test.each([
    ['no staging token', { NEARBY_STAGING_REF: REF }, /NEARBY_STAGING_ACCESS_TOKEN/],
    ['the production session token reused', { ...STAGING_ENV, SUPABASE_ACCESS_TOKEN: 'sbp_staging_only' }, /same token/],
    ['SUPABASE_PROJECT_REF set', { ...STAGING_ENV, SUPABASE_PROJECT_REF: REF }, /SUPABASE_PROJECT_REF is set/],
    ['a local DB URL set', { ...STAGING_ENV, NEARBY_LOCAL_DB_URL: 'postgres://x' }, /NEARBY_LOCAL_DB_URL/],
    ['production ref', { ...STAGING_ENV, NEARBY_STAGING_REF: PRODUCTION_REF }, /PRODUCTION/],
  ])('staging refused: %s', (_, env, msg) => expect(() => L.runner('staging', env)).toThrow(msg));
  test.each([
    ['NEARBY_STAGING_REF set', { NEARBY_STAGING_REF: REF }, /NEARBY_STAGING_REF is set/],
    ['NEARBY_STAGING_ACCESS_TOKEN set', { NEARBY_STAGING_ACCESS_TOKEN: 'x' }, /NEARBY_STAGING_ACCESS_TOKEN is set/],
    ['SUPABASE_PROJECT_REF = another project', { SUPABASE_PROJECT_REF: REF }, /names another project/],
  ])('production refused: %s', (_, env, msg) => expect(() => L.runner('prod', env)).toThrow(msg));
  test('production always targets production\'s ref, never an env override', () => {
    expect(L.runner('prod', {}).ref).toBe(PRODUCTION_REF);
    expect(L.runner('prod', { SUPABASE_PROJECT_REF: PRODUCTION_REF }).ref).toBe(PRODUCTION_REF);
  });
});

describe('approvals never cross environments', () => {
  const ledger = { exists: true, rows: [] };
  const base = { NEARBY_APPROVAL_REF: 'owner, test', NEARBY_SESSION_ID: 'jest' };
  const prodToken = `${facts.version}:${facts.sha256}`;
  const stagingToken = `staging:${facts.version}:${facts.sha256}`;
  const refusals = (target, env) => L.preflight({ facts, env: { ...base, ...env }, ledger, target })
    .filter((r) => !/out of order|baseline|already recorded/.test(r));
  test('each environment accepts only its own token', () => {
    expect(refusals('staging', { NEARBY_STAGING_APPROVAL: stagingToken })).toEqual([]);
    expect(refusals('prod', { NEARBY_PROD_APPROVAL: prodToken })).toEqual([]);
  });
  test('the production token is refused for staging and the staging token for production', () => {
    expect(refusals('staging', { NEARBY_STAGING_APPROVAL: prodToken }).join()).toMatch(/does not match/);
    expect(refusals('prod', { NEARBY_PROD_APPROVAL: stagingToken }).join()).toMatch(/does not match/);
  });
  test('the other environment\'s approval variable being set at all is refused', () => {
    expect(refusals('staging', { NEARBY_STAGING_APPROVAL: stagingToken, NEARBY_PROD_APPROVAL: prodToken }).join()).toMatch(/NEARBY_PROD_APPROVAL is set/);
    expect(refusals('prod', { NEARBY_PROD_APPROVAL: prodToken, NEARBY_STAGING_APPROVAL: stagingToken }).join()).toMatch(/NEARBY_STAGING_APPROVAL is set/);
  });
});

describe('deploy.js --target=staging', () => {
  function mockFetch(okUrl) {
    const sent = [];
    let deployed = false;
    global.fetch = async (url, opts) => {
      const q = JSON.parse(opts.body).query;
      sent.push({ url, q });
      let rows;
      if (/to_regclass\('private.migration_ledger'\)/.test(q)) rows = [{ exists: true }];
      else if (/json_agg/.test(q)) rows = [{ rows: deployed ? [{ version: facts.version, file_sha256: facts.sha256 }] : [] }];
      else { deployed = true; rows = []; }
      return { ok: url === okUrl, status: url === okUrl ? 200 : 403, text: async () => JSON.stringify(rows), json: async () => rows };
    };
    return sent;
  }
  afterEach(() => { delete global.fetch; });

  test('sends only to staging; the transaction re-points production URLs before its ledger row and COMMIT', async () => {
    if (!facts.tracked || !facts.clean) return;
    const sent = mockFetch(`https://api.supabase.com/v1/projects/${REF}/database/query`);
    const restore = quiet();
    const code = await deployMain([FILE, '--target=staging'], { ...STAGING_ENV, NEARBY_STAGING_APPROVAL: `staging:${facts.version}:${facts.sha256}`, NEARBY_APPROVAL_REF: 'test', NEARBY_SESSION_ID: 'jest' }, REPO);
    restore();
    expect(code).toBe(0);
    expect(sent.every((s) => s.url.includes(`/projects/${REF}/`))).toBe(true);
    const tx = sent.find((s) => /^begin;/.test(s.q)).q;
    expect(tx).toContain(B.repointSql(REF));
    expect(tx.indexOf('do $repoint$')).toBeLessThan(tx.indexOf('insert into private.migration_ledger'));
    expect(tx.trim().endsWith('commit;')).toBe(true);
    expect(tx).toContain(`'${facts.sha256}'`); // the ledger records the committed file's hash
    const audit = tx.indexOf('do $nearby_audit$');
    expect(audit).toBeGreaterThan(tx.indexOf('do $repoint$'));
    expect(audit).toBeLessThan(tx.indexOf('insert into private.migration_ledger'));
  });

  test('without the staging approval nothing beyond the ledger reads is sent', async () => {
    const sent = mockFetch(`https://api.supabase.com/v1/projects/${REF}/database/query`);
    const restore = quiet();
    const code = await deployMain([FILE, '--target=staging'], { ...STAGING_ENV, NEARBY_APPROVAL_REF: 'test', NEARBY_SESSION_ID: 'jest' }, REPO);
    restore();
    expect(code).toBe(2);
    expect(sent.some((s) => /^begin;/.test(s.q))).toBe(false);
  });

  test('a production deploy never carries the staging re-point', async () => {
    if (!facts.tracked || !facts.clean) return;
    const saved = process.env.SUPABASE_ACCESS_TOKEN;
    process.env.SUPABASE_ACCESS_TOKEN = 'sbp_fake_for_mock';
    const sent = mockFetch(`https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/query`);
    const restore = quiet();
    // version already "later than" nothing; the mock answers every read; the approval is production's own token
    await deployMain([FILE, '--target=prod', '--check'], { NEARBY_PROD_APPROVAL: `${facts.version}:${facts.sha256}`, NEARBY_APPROVAL_REF: 'test', NEARBY_SESSION_ID: 'jest' }, REPO);
    restore();
    if (saved === undefined) delete process.env.SUPABASE_ACCESS_TOKEN; else process.env.SUPABASE_ACCESS_TOKEN = saved;
    expect(sent.every((s) => s.url.includes(`/projects/${PRODUCTION_REF}/`))).toBe(true);
    expect(sent.some((s) => s.q.includes('$repoint$'))).toBe(false);
  });
});

describe('bootstrap.js', () => {
  test('repointSql refuses production\'s ref and anything malformed', () => {
    expect(() => B.repointSql(PRODUCTION_REF)).toThrow(/not a staging ref/);
    expect(() => B.repointSql('nope')).toThrow(/not a staging ref/);
    expect(B.repointSql(REF)).toContain(`replace(pg_get_functiondef(r.oid), '${PRODUCTION_REF}', '${REF}')`);
  });

  test('apply re-points inside EVERY migration transaction (no committed state ever names production)', async () => {
    const through = '20270100';
    const list = B.migrationList(through);
    const code = B.approvalCode(REF, list);
    const sent = [];
    const run = async (q) => {
      sent.push(q);
      if (/relnamespace = 'public'::regnamespace/.test(q)) return [{ n: 0 }];
      if (/as functions/.test(q)) return [{ functions: 0, cron_jobs: 0 }];
      return [];
    };
    await B.apply({ run, ref: REF, through, env: { NEARBY_STAGING_BOOTSTRAP_APPROVAL: code, NEARBY_SESSION_ID: 'jest' }, log: () => {} });
    const txs = sent.filter((q) => q.startsWith('begin;'));
    expect(txs.length).toBe(list.length);
    for (const tx of txs) {
      expect(tx).toContain(B.repointSql(REF));
      expect(tx.lastIndexOf('do $repoint$')).toBeLessThan(tx.lastIndexOf('commit;'));
    }
  });

  test('apply refuses a non-empty project and a wrong code before sending any migration', async () => {
    const sent = [];
    const nonEmpty = async (q) => { sent.push(q); return [{ n: 5 }]; };
    await expect(B.apply({ run: nonEmpty, ref: REF, through: '20270100', env: {}, log: () => {} })).rejects.toThrow(/not empty/);
    const empty = async (q) => { sent.push(q); return [{ n: 0 }]; };
    await expect(B.apply({ run: empty, ref: REF, through: '20270100', env: { NEARBY_STAGING_BOOTSTRAP_APPROVAL: 'wrong', NEARBY_SESSION_ID: 'x' }, log: () => {} })).rejects.toThrow(/approval missing or wrong/);
    expect(sent.some((q) => q.startsWith('begin;'))).toBe(false);
  });
});

describe('preflight: staging can\'t reach a real person or real money', () => {
  const clean = () => ({
    auth: Object.fromEntries([...P.SMS_CREDENTIAL_FIELDS, ...P.SMTP_FIELDS].map((f) => [f, false])),
    secretNames: ['ANTHROPIC_API_KEY'],
    db: { functions: 0, cron_jobs: 0, vault_names_production: false },
  });
  test('a clean staging project passes', () => expect(P.channelProblems(clean())).toEqual([]));
  test.each([
    ['Twilio SMS credentials in Auth', (c) => { c.auth.sms_twilio_auth_token = true; }, /SMS provider credentials/],
    ['phone sign-in with no test OTP', (c) => { c.auth.external_phone_enabled = true; }, /no test OTP/],
    ['custom SMTP', (c) => { c.auth.smtp_host = true; }, /custom SMTP/],
    ['Resend key', (c) => { c.secretNames.push('RESEND_API_KEY'); }, /real email/],
    ['Twilio secret', (c) => { c.secretNames.push('TWILIO_AUTH_TOKEN'); }, /real SMS/],
    ['Expo access token', (c) => { c.secretNames.push('EXPO_ACCESS_TOKEN'); }, /push credentials/],
    ['AWS key', (c) => { c.secretNames.push('AWS_ACCESS_KEY_ID'); }, /moderation account/],
    ['RevenueCat secret', (c) => { c.secretNames.push('REVENUECAT_WEBHOOK_SECRET'); }, /real purchases/],
    ['unconfirmed Stripe secret', (c) => { c.secretNames.push('STRIPE_SECRET_KEY'); }, /TEST keys/],
    ['Stripe without a staging website URL', (c) => { c.secretNames.push('STRIPE_SECRET_KEY'); }, /production website/],
    ['live Stripe approval flag', (c) => { c.secretNames.push('STRIPE_LIVE_APPROVED'); }, /live payments/],
    ['sponsored live flag', (c) => { c.secretNames.push('SPONSORED_LEGAL_REVIEW_COMPLETE'); }, /live sponsored/],
    ['App Store reviewer email', (c) => { c.secretNames.push('REVIEWER_EMAIL'); }, /reviewer login/],
    ['App Store reviewer PIN', (c) => { c.secretNames.push('REVIEW_LOGIN_PIN'); }, /reviewer login/],
    ['a function still naming production', (c) => { c.db.functions = 1; }, /still name production/],
    ['vault key for production', (c) => { c.db.vault_names_production = true; }, /PRODUCTION's project/],
  ])('refused: %s', (_, mutate, msg) => {
    const c = clean();
    mutate(c);
    expect(P.channelProblems(c).join('\n')).toMatch(msg);
  });
  test('a Stripe secret passes only with the owner\'s test-key confirmation', () => {
    const c = clean();
    c.secretNames.push('STRIPE_SECRET_KEY', 'BUSINESS_WEB_URL');
    expect(P.channelProblems({ ...c, env: { NEARBY_STAGING_STRIPE_TEST_KEY_CONFIRMED: '1' } })).toEqual([]);
  });
  test('readStaging reduces Auth secrets to booleans and talks only to the staging project', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (url.endsWith('/config/auth')) return { ok: true, json: async () => ({ external_phone_enabled: true, sms_test_otp: '15615550101=123456', sms_twilio_auth_token: 'SECRETVALUE' }) };
      if (url.endsWith('/secrets')) return { ok: true, json: async () => [{ name: 'SUPABASE_URL' }, { name: 'ANTHROPIC_API_KEY' }] };
      return { ok: true, text: async () => JSON.stringify([{ functions: 0, cron_jobs: 0, vault_names_production: false }]) };
    };
    const facts = await P.readStaging(STAGING_ENV, fetchImpl);
    expect(JSON.stringify(facts)).not.toContain('SECRETVALUE');
    expect(facts.auth.sms_twilio_auth_token).toBe(true);
    expect(facts.secretNames).toEqual(['ANTHROPIC_API_KEY']);
    expect(urls.every((u) => u.includes(`/projects/${REF}/`))).toBe(true);
  });
});

describe('functions-deploy.sh refuses before calling the Supabase CLI', () => {
  const script = path.join(__dirname, 'functions-deploy.sh');
  const runScript = (ref) => {
    try { execFileSync('bash', [script, 'send-push'], { env: { PATH: '/usr/bin:/bin', NEARBY_STAGING_REF: ref }, stdio: 'pipe' }); return 0; } catch (e) { return { code: e.status, out: String(e.stdout) }; }
  };
  test('production ref', () => expect(runScript(PRODUCTION_REF)).toEqual({ code: 1, out: expect.stringMatching(/PRODUCTION: refused/) }));
  test('missing or malformed ref', () => {
    expect(runScript('')).toEqual({ code: 1, out: expect.stringMatching(/missing or malformed/) });
    expect(runScript('abc')).toEqual({ code: 1, out: expect.stringMatching(/missing or malformed/) });
  });
});

describe('independent outbound audit (owner condition on approval B)', () => {
  const A = require('./outboundAudit');
  test('refuses production\'s ref and anything malformed', () => {
    expect(() => A.auditSql(PRODUCTION_REF)).toThrow(/not a staging ref/);
    expect(() => A.auditSql('x')).toThrow(/not a staging ref/);
  });
  test('its base64 fragments find the ref inside a legacy JWT payload at every alignment (base64 and base64url)', () => {
    for (const prefix of ['{"ref":"', '{"iss":"supabase","ref":"', '{"a":1,"ref":"']) {
      const payload = Buffer.from(`${prefix}${PRODUCTION_REF}","role":"service_role"}`).toString('base64');
      const url = payload.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect([prefix, A.base64Fragments(PRODUCTION_REF).some((f) => payload.includes(f))]).toEqual([prefix, true]);
      expect([prefix, A.base64Fragments(PRODUCTION_REF).some((f) => url.includes(f))]).toEqual([prefix, true]);
    }
  });
  test('scans every kind of outbound reference, allows only staging + the weather host, and only SELECTs', () => {
    const sql = A.auditSql(REF);
    for (const src of ['from pg_proc', 'from pg_trigger', 'pg_get_viewdef', 'from pg_attrdef', 'from pg_policy', 'from pg_constraint',
      'from pg_foreign_server', 'from pg_db_role_setting', 'from cron.job', 'from net.http_request_queue', 'from vault.decrypted_secrets',
      'from information_schema.columns']) expect([src, sql.includes(src)]).toEqual([src, true]);
    expect(sql).toContain(`'${REF}.supabase.co', 'api.openweathermap.org'`);
    const code = sql.replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i);
  });
  test('runAudit returns the findings from the database\'s refusal; other errors are rethrown', async () => {
    const fail = async () => { throw new Error('staging query failed (400): {"message":"ERROR:  STAGING_AUDIT_FAILED (2 finding(s)):\\nfunction f(): production reference\\ncron job 3: outbound host x.com"}'); };
    expect(await A.runAudit(fail, REF)).toEqual({ ok: false, findings: ['function f(): production reference', 'cron job 3: outbound host x.com'] });
    expect(await A.runAudit(async () => [], REF)).toEqual({ ok: true, findings: [] });
    await expect(A.runAudit(async () => { throw new Error('network down'); }, REF)).rejects.toThrow(/network down/);
  });
  test('placement: inside each staging migration transaction, after the re-point, before the ledger row and COMMIT', async () => {
    const sent = [];
    const through = '20260702';
    const list = B.migrationList(through);
    const run = async (q) => {
      sent.push(q);
      if (/relnamespace = 'public'::regnamespace/.test(q)) return [{ n: 0 }];
      if (/as functions/.test(q)) return [{ functions: 0, cron_jobs: 0 }];
      return [];
    };
    await B.apply({ run, ref: REF, through, env: { NEARBY_STAGING_BOOTSTRAP_APPROVAL: B.approvalCode(REF, list), NEARBY_SESSION_ID: 'jest' }, log: () => {} });
    const txs = sent.filter((q) => q.startsWith('begin;'));
    expect(txs.length).toBe(list.length);
    for (const tx of txs) {
      const a = tx.lastIndexOf('do $nearby_audit$');
      expect(a).toBeGreaterThan(tx.lastIndexOf('do $repoint$'));
      expect(a).toBeLessThan(tx.lastIndexOf('commit;'));
    }
    expect(sent[sent.length - 1]).toBe(A.auditSql(REF)); // and once more on the finished database
  });
  test('a bootstrap whose final audit finds something fails', async () => {
    const through = '20260702';
    const list = B.migrationList(through);
    const run = async (q) => {
      if (/relnamespace = 'public'::regnamespace/.test(q)) return [{ n: 0 }];
      if (/as functions/.test(q)) return [{ functions: 0, cron_jobs: 0 }];
      if (q === A.auditSql(REF)) throw new Error('ERROR: STAGING_AUDIT_FAILED (1 finding(s)):\ntrigger t.h: outbound host hooks.example.com');
      return [];
    };
    await expect(B.apply({ run, ref: REF, through, env: { NEARBY_STAGING_BOOTSTRAP_APPROVAL: B.approvalCode(REF, list), NEARBY_SESSION_ID: 'jest' }, log: () => {} }))
      .rejects.toThrow(/outbound audit FAILED[\s\S]*hooks\.example\.com/);
  });
  test('preflight refuses on any audit finding', () => {
    const c = { auth: {}, secretNames: [], db: { functions: 0, cron_jobs: 0, vault_names_production: false, auditFindings: ['data public.x.v: 1 row(s) with a production reference'] } };
    expect(P.channelProblems(c).join()).toMatch(/outbound audit: data public\.x\.v/);
  });
});
