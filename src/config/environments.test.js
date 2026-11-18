// Production vs staging separation (owner approval B, 2026-11-15). Proves, without any network:
//  * a production build is app.json exactly (plus the embedded production environment) and refuses any staging value;
//  * a staging build needs every staging value, refuses each production value, and installs as a separate app;
//  * at run time a missing or mixed environment creates NO Supabase client (nothing can be sent);
//  * staging turns off analytics, crash reports and in-app purchases and never carries a live Stripe key;
//  * nothing else in the app hard-codes production's backend, and the published business website carries no staging value.
const fs = require('fs');
const path = require('path');
const nearbyConfig = require('../../app.config');
const appJson = require('../../app.json');
const eas = require('../../eas.json');
const E = require('./environments');

const ROOT = path.resolve(__dirname, '../..');
const base = () => JSON.parse(JSON.stringify(appJson.expo));
const build = (env) => nearbyConfig({ config: base() }, env);

const STAGING = {
  APP_VARIANT: 'staging',
  NEARBY_STAGING_SUPABASE_URL: 'https://hxsioiiulubavhogzipx.supabase.co', // a staging-shaped ref (not the real one)
  NEARBY_STAGING_PUBLISHABLE_KEY: 'sb_publishable_stagingTESTkey_123',
  NEARBY_STAGING_EAS_PROJECT_ID: '11111111-2222-4333-8444-555555555555',
};

describe('production build', () => {
  test('is app.json unchanged except the embedded production environment', () => {
    const out = build({});
    const { nearbyEnv, ...extra } = out.extra;
    expect({ ...out, extra }).toEqual(base());
    expect(nearbyEnv).toEqual({ variant: 'production', supabaseUrl: E.PRODUCTION.supabaseUrl, publishableKey: E.PRODUCTION.publishableKey, bundleId: 'com.allenklein.nearby' });
    expect(out.ios.bundleIdentifier).toBe('com.allenklein.nearby');
    expect(out.extra.eas.projectId).toBe(E.PRODUCTION.easProjectId);
  });

  test('APP_VARIANT=production is the same as unset', () => {
    expect(build({ APP_VARIANT: 'production' })).toEqual(build({}));
  });

  test.each(Object.values(E.STAGING_ENV_VARS))('refuses when the staging value %s is set (never a silent mix)', (name) => {
    expect(() => build({ [name]: 'anything' })).toThrow(/production build but staging values are set/);
  });

  test('an unknown variant stops the build', () => {
    expect(() => build({ APP_VARIANT: 'prod' })).toThrow(/unknown APP_VARIANT/);
    expect(() => build({ APP_VARIANT: 'Staging' })).toThrow(/unknown APP_VARIANT/);
  });

  test('the web export base URL still works and still embeds production', () => {
    const out = build({ NEARBY_WEB_EXPORT_BASE_URL: '/Nearby/business' });
    expect(out.experiments.baseUrl).toBe('/Nearby/business');
    expect(out.extra.nearbyEnv.variant).toBe('production');
  });
});

describe('staging build', () => {
  test('a complete staging set builds a separate app on the staging backend', () => {
    const out = build(STAGING);
    expect(out.name).toBe('Nearby Staging');
    expect(out.slug).toBe('nearby-staging');
    expect(out.scheme).toBe('nearby-staging');
    expect(out.ios.bundleIdentifier).toBe('com.allenklein.nearby.staging');
    expect(out.android.package).toBe('com.allenklein.nearby.staging');
    expect(out.extra.eas.projectId).toBe(STAGING.NEARBY_STAGING_EAS_PROJECT_ID);
    expect(out.extra.nearbyEnv).toEqual({ variant: 'staging', supabaseUrl: STAGING.NEARBY_STAGING_SUPABASE_URL, publishableKey: STAGING.NEARBY_STAGING_PUBLISHABLE_KEY, bundleId: 'com.allenklein.nearby.staging' });
    expect(out.extra.stripePublishableKey).toBe('');
  });

  test('carries none of production\'s outside-service settings', () => {
    const out = build(STAGING);
    for (const k of E.STAGING_DROPPED_EXTRA) expect(out.extra).not.toHaveProperty(k);
    expect(JSON.stringify(out)).not.toContain(E.PRODUCTION.supabaseRef);
    expect(JSON.stringify(out)).not.toContain(E.PRODUCTION.publishableKey);
    expect(JSON.stringify(out)).not.toContain(E.PRODUCTION.easProjectId);
  });

  test.each([
    ['URL missing', { NEARBY_STAGING_SUPABASE_URL: '' }, /Supabase URL is missing/],
    ['publishable key missing', { NEARBY_STAGING_PUBLISHABLE_KEY: '' }, /publishable key is missing/],
    ['Expo project missing', { NEARBY_STAGING_EAS_PROJECT_ID: '' }, /Expo project id is missing/],
    ['URL = production', { NEARBY_STAGING_SUPABASE_URL: E.PRODUCTION.supabaseUrl }, /points at PRODUCTION/],
    ['URL contains production ref', { NEARBY_STAGING_SUPABASE_URL: `https://${E.PRODUCTION.supabaseRef}.supabase.co/x` }, /production project ref/],
    ['URL not a Supabase project', { NEARBY_STAGING_SUPABASE_URL: 'https://example.com' }, /must look like/],
    ['key = production', { NEARBY_STAGING_PUBLISHABLE_KEY: E.PRODUCTION.publishableKey }, /publishable key is PRODUCTION's/],
    ['key = a secret key', { NEARBY_STAGING_PUBLISHABLE_KEY: 'sb_secret_abc' }, /must start sb_publishable_/],
    ['Expo project = production', { NEARBY_STAGING_EAS_PROJECT_ID: E.PRODUCTION.easProjectId }, /Expo project id is PRODUCTION's/],
    ['Expo project malformed', { NEARBY_STAGING_EAS_PROJECT_ID: 'nearby' }, /must be a UUID/],
    ['live Stripe key', { NEARBY_STAGING_STRIPE_PUBLISHABLE_KEY: 'pk_live_abc' }, /pk_test_ key \(never live\)/],
  ])('refuses: %s', (_, override, message) => {
    expect(() => build({ ...STAGING, ...override })).toThrow(message);
  });

  test('a Stripe TEST key is carried; nothing else', () => {
    expect(build({ ...STAGING, NEARBY_STAGING_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc' }).extra.stripePublishableKey).toBe('pk_test_abc');
  });
});

describe('run time (what the installed app checks before creating a client)', () => {
  const prodEnv = () => build({}).extra.nearbyEnv;
  const stagingEnv = () => build(STAGING).extra.nearbyEnv;

  test('each build\'s own embedded environment passes', () => {
    expect(E.checkRuntimeEnvironment(prodEnv()).ok).toBe(true);
    expect(E.checkRuntimeEnvironment(stagingEnv()).ok).toBe(true);
  });

  test.each([
    ['nothing embedded', undefined],
    ['unknown variant', { ...stagingEnv(), variant: 'qa' }],
    ['production label with the staging URL', { ...prodEnv(), supabaseUrl: STAGING.NEARBY_STAGING_SUPABASE_URL }],
    ['production label with the staging key', { ...prodEnv(), publishableKey: STAGING.NEARBY_STAGING_PUBLISHABLE_KEY }],
    ['production label with the staging bundle id', { ...prodEnv(), bundleId: 'com.allenklein.nearby.staging' }],
    ['staging label with the production URL', { ...stagingEnv(), supabaseUrl: E.PRODUCTION.supabaseUrl }],
    ['staging label with the production key', { ...stagingEnv(), publishableKey: E.PRODUCTION.publishableKey }],
    ['staging label with the production bundle id', { ...stagingEnv(), bundleId: 'com.allenklein.nearby' }],
    ['staging with no key', { ...stagingEnv(), publishableKey: '' }],
  ])('refused: %s', (_, embedded) => {
    expect(E.checkRuntimeEnvironment(embedded).ok).toBe(false);
  });

  test('staging talks to none of production\'s outside services', () => {
    expect(E.serviceSwitches('production')).toEqual({ analytics: true, crashReporting: true, inAppPurchases: true });
    expect(E.serviceSwitches('staging')).toEqual({ analytics: false, crashReporting: false, inAppPurchases: false });
    expect(E.serviceSwitches(null)).toEqual({ analytics: false, crashReporting: false, inAppPurchases: false });
  });
});

describe('src/services/supabase.js creates a client only for a valid environment', () => {
  function load(nearbyEnv) {
    const createClient = jest.fn((url, key) => ({ url, key }));
    let mod;
    jest.isolateModules(() => {
      jest.doMock('react-native-url-polyfill/auto', () => ({}), { virtual: true });
      jest.doMock('@react-native-async-storage/async-storage', () => ({}));
      jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { nearbyEnv } } } }));
      jest.doMock('@supabase/supabase-js', () => ({ createClient }));
      mod = require('../services/supabase');
    });
    return { mod, createClient };
  }

  test('production build -> production client', () => {
    const { mod, createClient } = load(build({}).extra.nearbyEnv);
    expect(createClient).toHaveBeenCalledWith(E.PRODUCTION.supabaseUrl, E.PRODUCTION.publishableKey, expect.any(Object));
    expect(mod.ENVIRONMENT_ERROR).toBeNull();
    expect(mod.functionUrl('send-push')).toBe(`${E.PRODUCTION.supabaseUrl}/functions/v1/send-push`);
    expect(mod.PUBLISHABLE_KEY).toBe(E.PRODUCTION.publishableKey);
  });

  test('staging build -> staging client, outside services off', () => {
    const { mod, createClient } = load(build(STAGING).extra.nearbyEnv);
    expect(createClient).toHaveBeenCalledWith(STAGING.NEARBY_STAGING_SUPABASE_URL, STAGING.NEARBY_STAGING_PUBLISHABLE_KEY, expect.any(Object));
    expect(mod.functionUrl('review-login')).toBe(`${STAGING.NEARBY_STAGING_SUPABASE_URL}/functions/v1/review-login`);
    expect(mod.PUBLISHABLE_KEY).toBe(STAGING.NEARBY_STAGING_PUBLISHABLE_KEY);
    expect(mod.SERVICES).toEqual({ analytics: false, crashReporting: false, inAppPurchases: false });
  });

  test.each([
    ['no environment', undefined],
    ['staging label, production URL', { ...build(STAGING).extra.nearbyEnv, supabaseUrl: E.PRODUCTION.supabaseUrl }],
    ['production label, staging URL', { ...build({}).extra.nearbyEnv, supabaseUrl: STAGING.NEARBY_STAGING_SUPABASE_URL }],
  ])('%s -> no client at all; every use throws; no fallback to production', (_, embedded) => {
    const { mod, createClient } = load(embedded);
    expect(createClient).not.toHaveBeenCalled();
    expect(mod.ENVIRONMENT_ERROR).toEqual(expect.any(String));
    expect(() => mod.supabase.from('profiles')).toThrow(/not connected/);
    expect(() => mod.functionUrl('send-push')).toThrow(/not connected/);
    expect(mod.PUBLISHABLE_KEY).toBeNull();
    expect(mod.SERVICES).toEqual({ analytics: false, crashReporting: false, inAppPurchases: false });
  });
});

describe('EAS profiles', () => {
  test('staging profile: internal distribution, APP_VARIANT=staging, device build', () => {
    const s = eas.build.staging;
    expect(s.distribution).toBe('internal');
    expect(s.env.APP_VARIANT).toBe('staging');
    expect(s.ios.simulator).toBe(false);
  });

  test('production profile never sets a variant or a staging value; staging can\'t be submitted to the store', () => {
    for (const [name, profile] of Object.entries(eas.build).filter(([n]) => n !== 'staging')) {
      const env = profile.env || {};
      expect([name, env.APP_VARIANT]).toEqual([name, undefined]);
      for (const k of Object.values(E.STAGING_ENV_VARS)) expect(env).not.toHaveProperty(k);
    }
    expect(Object.keys(eas.submit)).toEqual(['production']);
  });
});

describe('one source for the backend', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });

  test('no app file besides src/config/environments.js names production\'s project or key', () => {
    const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'App.js'), path.join(ROOT, 'App.web.js')]
      .filter((f) => /\.(js|ts|tsx)$/.test(f) && !/\.test\.js$/.test(f) && !/\.live\.js$/.test(f))
      .filter((f) => !f.includes(`${path.sep}src${path.sep}qa${path.sep}`) && !f.endsWith(path.join('src', 'config', 'environments.js')));
    const offenders = files.filter((f) => {
      const s = fs.readFileSync(f, 'utf8');
      return s.includes(E.PRODUCTION.supabaseRef) || s.includes(E.PRODUCTION.publishableKey);
    }).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  test('the published business website (docs/business, GitHub Pages = production) carries no staging value', () => {
    const dir = path.join(ROOT, 'docs', 'business');
    if (!fs.existsSync(dir)) return;
    const bundles = walk(dir).filter((f) => /\.(js|html)$/.test(f));
    for (const f of bundles) {
      const s = fs.readFileSync(f, 'utf8');
      expect([f, /"variant":"staging"|nearby-staging|com\.allenklein\.nearby\.staging/.test(s)]).toEqual([f, false]);
      const refs = [...s.matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)].map((m) => m[1]);
      expect([f, refs.filter((r) => r !== E.PRODUCTION.supabaseRef)]).toEqual([f, []]);
    }
  });
});
