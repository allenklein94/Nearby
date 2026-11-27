import {
  appUpdateState, showOptionalNotice, safeUpdateUrl, isUpdateRequiredBody, versionHeaders, normalizeBuild, cacheKey,
} from './appUpdatePolicy';

const P = (min, latest, update_url = 'itms-beta://x/y') => ({ min_supported_build: min, latest_build: latest, update_url });

describe('appUpdateState: the one rule', () => {
  test('boundaries: below min = required, at min below latest = optional, at latest = current', () => {
    expect(appUpdateState({ build: 89, policy: P(90, 92) })).toBe('required');
    expect(appUpdateState({ build: 90, policy: P(90, 92) })).toBe('optional');
    expect(appUpdateState({ build: 91, policy: P(90, 92) })).toBe('optional');
    expect(appUpdateState({ build: 92, policy: P(90, 92) })).toBe('current');
    expect(appUpdateState({ build: 200, policy: P(90, 92) })).toBe('current');
  });
  test('min only while enforced (the server sends null otherwise) = never required', () => {
    expect(appUpdateState({ build: 1, policy: P(null, 92) })).toBe('optional');
    expect(appUpdateState({ build: 1, policy: P(null, null) })).toBe('current');
  });
  test('never locks out on a guess: unknown build, no policy, garbage policy', () => {
    expect(appUpdateState({ build: null, policy: P(999, 999) })).toBe('current');
    expect(appUpdateState({ build: 'dev', policy: P(999, 999) })).toBe('current');
    expect(appUpdateState({ build: 50, policy: null })).toBe('current');
    expect(appUpdateState({ build: 50, policy: 'x' })).toBe('current');
    expect(appUpdateState({ build: 50, policy: P('abc', -1) })).toBe('current');
    expect(appUpdateState({})).toBe('current');
  });
  test('the server refusing a request = required, even with an older cached policy', () => {
    expect(appUpdateState({ build: 50, policy: null, serverRefused: true })).toBe('required');
    expect(appUpdateState({ build: null, serverRefused: true })).toBe('current');
  });
  test('numeric strings from the native build number are read', () => {
    expect(normalizeBuild('88')).toBe(88);
    expect(normalizeBuild(' 88 ')).toBe(88);
    expect(normalizeBuild('88.1')).toBeNull();
    expect(normalizeBuild(0)).toBeNull();
    expect(appUpdateState({ build: '89', policy: P(90, 90) })).toBe('required');
  });
});

describe('optional notice', () => {
  test('once per newer build', () => {
    const policy = P(null, 92);
    expect(showOptionalNotice({ state: 'optional', policy, dismissedLatest: null })).toBe(true);
    expect(showOptionalNotice({ state: 'optional', policy, dismissedLatest: 92 })).toBe(false);
    expect(showOptionalNotice({ state: 'optional', policy: P(null, 93), dismissedLatest: 92 })).toBe(true);
    expect(showOptionalNotice({ state: 'current', policy, dismissedLatest: null })).toBe(false);
    expect(showOptionalNotice({ state: 'required', policy, dismissedLatest: null })).toBe(false);
  });
});

describe('links, headers, refusals', () => {
  test('only safe update links', () => {
    expect(safeUpdateUrl('https://apps.apple.com/app/id1')).toBe('https://apps.apple.com/app/id1');
    expect(safeUpdateUrl('itms-beta://testflight.apple.com/join/abc')).toBeTruthy();
    expect(safeUpdateUrl('market://details?id=com.allenklein.nearby')).toBeTruthy();
    expect(safeUpdateUrl('http://example.com')).toBeNull();
    expect(safeUpdateUrl('javascript:alert(1)')).toBeNull();
    expect(safeUpdateUrl(null)).toBeNull();
  });
  test('headers only for a known build + platform', () => {
    expect(versionHeaders({ build: 88, platform: 'ios' })).toEqual({ 'x-nearby-build': '88', 'x-nearby-platform': 'ios' });
    expect(versionHeaders({ build: null, platform: 'ios' })).toBeNull();
    expect(versionHeaders({ build: 88, platform: 'windows' })).toBeNull();
  });
  test('the server refusal is recognised by its hint only', () => {
    expect(isUpdateRequiredBody({ code: 'P0001', hint: 'app_update_required' })).toBe(true);
    expect(isUpdateRequiredBody({ hint: 'business_selection_changed' })).toBe(false);
    expect(isUpdateRequiredBody(null)).toBe(false);
  });
  test('staging and production caches never share a key', () => {
    expect(cacheKey('staging', 'ios')).not.toBe(cacheKey('production', 'ios'));
  });
});

describe('policyFromResponse', () => {
  const { policyFromResponse } = require('./appUpdatePolicy');
  test('200 = the row; no row = no policy', () => {
    expect(policyFromResponse(200, { platform: 'ios', min_supported_build: 88 })).toEqual({ platform: 'ios', min_supported_build: 88 });
    expect(policyFromResponse(200, null)).toBeNull();
    expect(policyFromResponse(200, [])).toBeNull();
  });
  test('a database before 20270434 (function missing) = no policy, never "required"', () => {
    expect(policyFromResponse(404, { code: 'PGRST202' })).toBeNull();
    expect(policyFromResponse(404, null)).toBeNull();
  });
  test('everything else = unavailable (keep the last known state)', () => {
    expect(() => policyFromResponse(500, {})).toThrow(/unavailable/);
    expect(() => policyFromResponse(401, { code: 'PGRST301' })).toThrow(/unavailable/);
    expect(() => policyFromResponse(503, null)).toThrow(/unavailable/);
    expect(() => policyFromResponse(404, { code: 'PGRST205' })).toThrow(/unavailable/);
  });
});
