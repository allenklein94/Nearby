// Google Maps key substitution (2026-11-15): app.json's "$GOOGLE_MAPS_API_KEY" placeholder becomes the EAS variable; a
// production EAS build without it stops. Before this fix every build shipped the literal placeholder as the key.
const nearbyConfig = require('../../app.config');
const appJson = require('../../app.json');
const eas = require('../../eas.json');

const base = () => JSON.parse(JSON.stringify(appJson.expo));
const build = (env) => nearbyConfig({ config: base() }, env);

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
  expect(c).toEqual(expected);
});

test('a production EAS build without the variable stops', () => {
  expect(() => build({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production' })).toThrow(/GOOGLE_MAPS_API_KEY is not set/);
  expect(() => build({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production', GOOGLE_MAPS_API_KEY: '  ' })).toThrow(/GOOGLE_MAPS_API_KEY is not set/);
});

test('locally (expo start, tests, web export) a missing variable leaves app.json as it was', () => {
  expect(build({})).toEqual(base());
  expect(build({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' })).toEqual(base());
});

test('the web export base URL still applies, and the public website never gets the key', () => {
  const c = build({ NEARBY_WEB_EXPORT_BASE_URL: '/Nearby/business', GOOGLE_MAPS_API_KEY: 'AIzaTESTkey_123' });
  expect(c.experiments.baseUrl).toBe('/Nearby/business');
  expect(JSON.stringify(c)).not.toContain('AIzaTESTkey_123');
});

test('the production EAS profile reads the "production" environment, where GOOGLE_MAPS_API_KEY lives', () => {
  expect(eas.build.production.environment).toBe('production');
});
