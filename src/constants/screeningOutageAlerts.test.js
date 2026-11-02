// Screening outage alerts (owner 2026-11-02, migration 20270387): the failure classifier, the reporter and the wiring.
const fs = require('fs');
const path = require('path');
const { screeningFailureKind, reportScreeningHealth, SCREENING_FAILURE_KINDS, DEFINITIVE_FAILURE_KINDS } =
  require('../../supabase/functions/_shared/screeningHealth.js');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const cls = read('supabase/functions/_shared/contentClassifier.ts');
const fn = read('supabase/functions/screen-business-content/index.ts');
const mig = read('supabase/migrations/20270387_screening_outage_alerts.sql');

describe('screeningFailureKind: provider failures only, by kind', () => {
  test.each([
    [{ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } } }, 'credit'],
    [{ status: 401, body: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, 'credentials'],
    [{ status: 403, body: { error: { type: 'permission_error', message: 'not allowed' } } }, 'credentials'],
    [{ keyMissing: true }, 'credentials'],
    [{ status: 404, body: { error: { type: 'not_found_error', message: 'model: claude-haiku-4-5-20251001' } } }, 'model'],
    [{ status: 400, body: { error: { type: 'invalid_request_error', message: 'The model claude-x has been retired' } } }, 'model'],
    [{ status: 429, body: { error: { type: 'rate_limit_error', message: 'slow down' } } }, 'rate_limit'],
    [{ status: 529, body: { error: { type: 'overloaded_error', message: 'Overloaded' } } }, 'provider_error'],
    [{ status: 500, body: null }, 'provider_error'],
    [{ error: Object.assign(new Error('t'), { name: 'TimeoutError' }) }, 'timeout'],
    [{ error: new TypeError('fetch failed') }, 'provider_error'],
  ])('%j -> %s', (input, kind) => {
    expect(screeningFailureKind(input)).toBe(kind);
  });

  test('every kind is one the database accepts; the definitive ones open an outage at once', () => {
    for (const k of SCREENING_FAILURE_KINDS) expect(mig).toContain(`'${k}'`);
    expect(mig).toMatch(/if v_kind not in \('credit', 'credentials', 'model'\) then/);
    expect(DEFINITIVE_FAILURE_KINDS).toEqual(['credit', 'credentials', 'model']);
  });
});

describe('reportScreeningHealth: only ok / kind / status / source leave, and it never throws', () => {
  test('sends exactly those fields to the service-role RPC', async () => {
    const calls = [];
    await reportScreeningHealth({ ok: false, kind: 'credit', status: 400 }, { url: 'https://x.supabase.co', key: 'sk' },
      async (u, init) => { calls.push([u, init]); return { ok: true }; });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('https://x.supabase.co/rest/v1/rpc/record_screening_service_result');
    expect(JSON.parse(calls[0][1].body)).toEqual({ source_param: 'business-content', ok_param: false, kind_param: 'credit', http_status_param: 400 });
  });
  test('an unknown kind is sent as provider_error; ok sends no kind', async () => {
    const bodies = [];
    const f = async (_u, init) => { bodies.push(JSON.parse(init.body)); };
    await reportScreeningHealth({ ok: false, kind: 'weird' }, { url: 'u', key: 'k' }, f);
    await reportScreeningHealth({ ok: true, kind: 'credit' }, { url: 'u', key: 'k' }, f);
    expect(bodies[0].kind_param).toBe('provider_error');
    expect(bodies[1]).toMatchObject({ ok_param: true, kind_param: null });
  });
  test('a failing or missing endpoint never throws (monitoring never affects screening)', async () => {
    await expect(reportScreeningHealth({ ok: false, kind: 'credit' }, { url: 'u', key: 'k' }, async () => { throw new Error('down'); })).resolves.toBeUndefined();
    await expect(reportScreeningHealth({ ok: true }, {}, async () => { throw new Error('never called'); })).resolves.toBeUndefined();
  });
});

describe('wiring: every Anthropic screening call reports, fail-closed unchanged, nothing sensitive logged or sent', () => {
  test('text classifier: missing key, network/timeout, bad response, unreadable JSON and success all report', () => {
    expect(cls).toMatch(/keyMissing: true/);
    expect(cls).toMatch(/SERVICE_FAILURE request failed[\s\S]{0,120}reportClassifierHealth\(false, screeningFailureKind\(\{ error: e \}\)\)[\s\S]{0,40}return null/);
    expect(cls).toMatch(/unexpected Anthropic response[\s\S]{0,200}reportClassifierHealth\(false, screeningFailureKind\(\{ status: anthropicResponse\.status, body: anthropicData \}\)/);
    expect(cls).toMatch(/reportClassifierHealth\(false, 'bad_reply'/);
    expect(cls).toMatch(/await reportClassifierHealth\(true\);\n\n  const riskTier/);
  });
  test('logo (vision) classifier reports the same way and now times out', () => {
    expect(fn).toMatch(/vision request failed[\s\S]{0,120}reportClassifierHealth\(false, screeningFailureKind\(\{ error: e \}\)\)/);
    expect(fn).toMatch(/vision response[\s\S]{0,200}reportClassifierHealth\(false/);
    expect((fn.match(/AbortSignal\.timeout\(20000\)/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
  test('the model\'s raw reply (which may echo the content) is never logged; only its length', () => {
    expect(cls).not.toMatch(/console\.error\([^)]*valid JSON', raw\)/);
    expect(fn).not.toMatch(/console\.error\([^)]*valid JSON for image', raw\)/);
  });
  test('the alert carries only type, phase and kind; recipients = unsuspended admins; deduped per outage + phase + admin', () => {
    expect(mig).toMatch(/jsonb_build_object\('type', 'admin_screening_outage', 'phase', v_phase, 'kind', kind_param\)/);
    expect(mig).toMatch(/p\.is_admin is true and p\.suspended_at is null/);
    expect(mig).toMatch(/'screening_outage:' \|\| outage_id_param \|\| ':' \|\| phase_param \|\| ':' \|\| r\.id/);
    expect(mig).toMatch(/grant execute on function public\.record_screening_service_result\(text, boolean, text, integer\) to service_role;/);
    expect(mig).not.toMatch(/to authenticated|to anon/);
  });
});
