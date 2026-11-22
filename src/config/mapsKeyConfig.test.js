// Google Maps key substitution (2026-11-15): app.json's "$GOOGLE_MAPS_API_KEY" placeholder becomes the EAS variable; a
// production EAS build without it stops. Before this fix every build shipped the literal placeholder as the key.
const nearbyConfig = require('../../app.config');
const appJson = require('../../app.json');
const eas = require('../../eas.json');

const base = () => JSON.parse(JSON.stringify(appJson.expo));
// app.config.js also embeds extra.nearbyEnv (staging/production environment, owner approval B); the Maps tests compare
// everything else, and the staging tests below check the environment itself.
const withoutEnv = (c) => { const out = JSON.parse(JSON.stringify(c)); delete out.extra.nearbyEnv; return out; };
const build = (env) => nearbyConfig({ config: base() }, env);
const buildNoEnv = (env) => withoutEnv(build(env));

test('app.json still carries the placeholder in exactly the three Maps settings', () => {
  const c = base();
  expect([c.ios.config.googleMapsApiKey, c.android.config.googleMaps.apiKey, c.extra.googleMapsApiKey]).toEqual(Array(3).fill('$GOOGLE_MAPS_API_KEY'));
});

test('with the variable set, all three get the real key and no placeholder is left', () => {
  const c = build({ GOOGLE_MAPS_API_KEY: 'AIzaTESTkey_123' });
  expect([c.ios.config.googleMapsApiKey, c.android.config.googleMaps.apiKey, c.extra.googleMapsApiKey]).toEqual(Array(3).fill('AIzaTESTkey_123'));
  expect(JSON.stringify(c)).not.toContain('$GOOGLE_MAPS_API_KEY');
  // nothing else changes
  const expected = base();
  expected.ios.config.googleMapsApiKey = expected.android.config.googleMaps.apiKey = expected.extra.googleMapsApiKey = 'AIzaTESTkey_123';
  expect(withoutEnv(c)).toEqual(expected);
  expect(c.extra.nearbyEnv.variant).toBe('production');
});

test('a production EAS build without the variable stops', () => {
  expect(() => build({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production' })).toThrow(/GOOGLE_MAPS_API_KEY is not set/);
  expect(() => build({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production', GOOGLE_MAPS_API_KEY: '  ' })).toThrow(/GOOGLE_MAPS_API_KEY is not set/);
});

test('locally (expo start, tests, web export) a missing variable leaves app.json as it was', () => {
  expect(buildNoEnv({})).toEqual(base());
  expect(buildNoEnv({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' })).toEqual(base());
});

test('the web export base URL still applies, and the public website never gets the key', () => {
  const c = build({ NEARBY_WEB_EXPORT_BASE_URL: '/Nearby/business', GOOGLE_MAPS_API_KEY: 'AIzaTESTkey_123' });
  expect(c.experiments.baseUrl).toBe('/Nearby/business');
  expect(JSON.stringify(c)).not.toContain('AIzaTESTkey_123');
});

test('the production EAS profile reads the "production" environment, where GOOGLE_MAPS_API_KEY lives', () => {
  expect(eas.build.production.environment).toBe('production');
});

// Staging (2026-11-22, main merged into the staging branch): a staging build never takes production's Maps key.
const stagingEnv = {
  APP_VARIANT: 'staging',
  NEARBY_STAGING_EAS_PROJECT_ID: '6f49be3c-0885-45bf-892f-3b722cd4aa54',
  NEARBY_STAGING_SUPABASE_URL: 'https://hxsioiiulubavhogzipo.supabase.co',
  NEARBY_STAGING_PUBLISHABLE_KEY: 'sb_publishable_stagingTEST',
};

test("a staging build ignores production's GOOGLE_MAPS_API_KEY, even on the EAS builder", () => {
  const c = build({ ...stagingEnv, GOOGLE_MAPS_API_KEY: 'AIzaPRODkey_999', EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'staging' });
  expect(c.ios.bundleIdentifier).toBe('com.allenklein.nearby.staging');
  expect(c.extra.nearbyEnv.variant).toBe('staging');
  expect(JSON.stringify(c)).not.toContain('AIzaPRODkey_999');
  expect(JSON.stringify(c)).not.toContain('enmosvippabmuqslzrox');
});

test('a staging build uses only its own NEARBY_STAGING_GOOGLE_MAPS_API_KEY when one is set', () => {
  const c = build({ ...stagingEnv, NEARBY_STAGING_GOOGLE_MAPS_API_KEY: 'AIzaSTAGINGkey_1', GOOGLE_MAPS_API_KEY: 'AIzaPRODkey_999' });
  expect([c.ios.config.googleMapsApiKey, c.android.config.googleMaps.apiKey, c.extra.googleMapsApiKey]).toEqual(Array(3).fill('AIzaSTAGINGkey_1'));
  expect(JSON.stringify(c)).not.toContain('AIzaPRODkey_999');
});

test('the staging EAS profile stays on the preview environment, never production', () => {
  expect(eas.build.staging.environment).toBe('preview');
  expect(eas.build.staging.env.APP_VARIANT).toBe('staging');
  expect(eas.build.production.env.APP_VARIANT).toBeUndefined();
});
