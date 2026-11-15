// Staging isolation (owner, 2026-11-15): a staging build can never talk to production, a production build is unchanged
// and can never carry a staging backend, and the migration tools' staging target can never reach production.
const { PRODUCTION, PRODUCTION_REF, resolveBackend, stagingProblems } = require('./backend');
const nearbyConfig = require('../../app.config');
const appJson = require('../../app.json');
const { stagingRunner, runner } = require('../../scripts/migrations/ledger');

const STAGING_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const STAGING_KEY = 'sb_publishable_staging_example';
const base = () => JSON.parse(JSON.stringify(appJson.expo));

describe('backend resolution (app + website)', () => {
  test('no override = production, exactly the old values', () => {
    expect(resolveBackend(undefined)).toMatchObject({ ok: true, variant: 'production', url: PRODUCTION.url, key: PRODUCTION.key });
    expect(resolveBackend(base().extra)).toMatchObject({ ok: true, variant: 'production', url: `https://${PRODUCTION_REF}.supabase.co` });
  });
  test('a production build carrying a backend override is refused', () => {
    expect(resolveBackend({ nearbyBackend: { url: STAGING_URL, key: STAGING_KEY } }).ok).toBe(false);
  });
  test('a valid staging backend is used', () => {
    expect(resolveBackend({ nearbyVariant: 'staging', nearbyBackend: { url: STAGING_URL, key: STAGING_KEY } }))
      .toMatchObject({ ok: true, variant: 'staging', url: STAGING_URL, key: STAGING_KEY });
  });
  test.each([
    ['production URL', { url: PRODUCTION.url, key: STAGING_KEY }, /PRODUCTION/],
    ['production key', { url: STAGING_URL, key: PRODUCTION.key }, /PRODUCTION key/],
    ['missing URL', { key: STAGING_KEY }, /missing/],
    ['missing key', { url: STAGING_URL }, /missing/],
    ['not a Supabase URL', { url: 'https://example.com', key: STAGING_KEY }, /must look like/],
    ['prod ref hidden in a path', { url: `https://abcdefghijklmnopqrst.supabase.co/${PRODUCTION_REF}`, key: STAGING_KEY }, /PRODUCTION|must look like/],
  ])('staging refused: %s', (_n, backend, re) => {
    const r = resolveBackend({ nearbyVariant: 'staging', nearbyBackend: backend });
    expect(r.ok).toBe(false);
    expect(r.problems.join('; ')).toMatch(re);
    expect(r.url).toBeUndefined();
  });
  test('staging Stripe: pk_test_ only', () => {
    expect(stagingProblems({ url: STAGING_URL, key: STAGING_KEY, stripePublishableKey: 'pk_test_x' })).toEqual([]);
    expect(stagingProblems({ url: STAGING_URL, key: STAGING_KEY, stripePublishableKey: 'pk_live_x' }).join()).toMatch(/pk_test_/);
  });
  test('the Supabase client refuses to start on a refused backend (no client, no request)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../services/supabase.js'), 'utf8');
    expect(src).toMatch(/if \(!BACKEND\.ok\) throw new Error/);
    expect(src.indexOf('if (!BACKEND.ok) throw')).toBeLessThan(src.indexOf('createClient(SUPABASE_URL'));
    expect(src).not.toContain(PRODUCTION_REF); // the ref lives only in config/backend.js
  });
});

describe('app.config.js', () => {
  test('without APP_VARIANT the config is app.json unchanged (build 87 path)', () => {
    expect(nearbyConfig({ config: base() }, {})).toEqual(base());
  });
  test('staging: own name + bundle ids, staging backend, analytics flag via variant', () => {
    const c = nearbyConfig({ config: base() }, { APP_VARIANT: 'staging', NEARBY_STAGING_SUPABASE_URL: STAGING_URL, NEARBY_STAGING_PUBLISHABLE_KEY: STAGING_KEY });
    expect(c.name).toBe('Nearby Staging');
    expect(c.ios.bundleIdentifier).toBe(`${base().ios.bundleIdentifier}.staging`);
    expect(c.android.package).toBe(`${base().android.package}.staging`);
    expect(c.extra.nearbyVariant).toBe('staging');
    expect(resolveBackend(c.extra)).toMatchObject({ ok: true, url: STAGING_URL });
    expect(JSON.stringify(c)).not.toContain(PRODUCTION.key);
  });
  test('staging build FAILS when anything points at production or is missing', () => {
    const env = { APP_VARIANT: 'staging', NEARBY_STAGING_SUPABASE_URL: STAGING_URL, NEARBY_STAGING_PUBLISHABLE_KEY: STAGING_KEY };
    expect(() => nearbyConfig({ config: base() }, { ...env, NEARBY_STAGING_SUPABASE_URL: PRODUCTION.url })).toThrow(/PRODUCTION/);
    expect(() => nearbyConfig({ config: base() }, { ...env, NEARBY_STAGING_PUBLISHABLE_KEY: PRODUCTION.key })).toThrow(/PRODUCTION/);
    expect(() => nearbyConfig({ config: base() }, { APP_VARIANT: 'staging' })).toThrow(/missing/);
    expect(() => nearbyConfig({ config: base() }, { ...env, NEARBY_STAGING_STRIPE_PUBLISHABLE_KEY: 'pk_live_x' })).toThrow(/pk_test_/);
    expect(() => nearbyConfig({ config: base() }, { APP_VARIANT: 'prod' })).toThrow(/Unknown APP_VARIANT/);
  });
  test('the web export base URL still applies, alone or with staging', () => {
    expect(nearbyConfig({ config: base() }, { NEARBY_WEB_EXPORT_BASE_URL: '/Nearby/business' }).experiments.baseUrl).toBe('/Nearby/business');
  });
  test('eas.json: a staging profile sets APP_VARIANT; production does not', () => {
    const eas = require('../../eas.json');
    expect(eas.build.staging.env.APP_VARIANT).toBe('staging');
    expect(eas.build.staging.distribution).toBe('internal');
    expect(eas.build.production.env.APP_VARIANT).toBeUndefined();
  });
  test('the published website (docs/business) never carries a staging backend', () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '../../docs/business/_expo/static/js/web');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toContain('"nearbyVariant":"staging"');
  });
});

describe('migration tools: --target=staging', () => {
  const ok = { NEARBY_STAGING_REF: 'abcdefghijklmnopqrst', NEARBY_STAGING_ACCESS_TOKEN: 'sbp_staging' };
  test.each([
    ['production ref', { ...ok, NEARBY_STAGING_REF: PRODUCTION_REF }, /PRODUCTION/],
    ['missing ref', { NEARBY_STAGING_ACCESS_TOKEN: 'x' }, /needs NEARBY_STAGING_REF/],
    ['malformed ref', { ...ok, NEARBY_STAGING_REF: 'abc' }, /does not look like/],
    ['missing token', { NEARBY_STAGING_REF: 'abcdefghijklmnopqrst' }, /needs NEARBY_STAGING_ACCESS_TOKEN/],
    ['same token as production', { ...ok, SUPABASE_ACCESS_TOKEN: 'sbp_staging' }, /separate staging token/],
    ['local DB also set', { ...ok, NEARBY_LOCAL_DB_URL: 'postgres://x' }, /NEARBY_LOCAL_DB_URL/],
  ])('refused: %s', (_n, env, re) => {
    expect(() => stagingRunner(env)).toThrow(re);
  });
  test('queries go only to the staging project, with the staging token', async () => {
    const calls = [];
    const r = stagingRunner(ok, async (url, opts) => { calls.push({ url, auth: opts.headers.Authorization }); return { ok: true, text: async () => '[{"a":1}]' }; });
    expect(await r.run('select 1 as a')).toEqual([{ a: 1 }]);
    expect(calls).toEqual([{ url: 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query', auth: 'Bearer sbp_staging' }]);
  });
  test('an unknown target is still refused', () => {
    expect(() => runner('production')).toThrow(/--target=prod, --target=staging or --target=local/);
  });
});
