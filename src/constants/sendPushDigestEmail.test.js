import fs from 'fs';
import path from 'path';

// Runs the REAL supabase/functions/send-push handler (imports stubbed) to prove the business opportunity digest reaches a
// web-only owner by email, and only under the right conditions. send-push is Deno code Jest can't import, so the source is
// loaded with its three import lines removed and its dependencies injected.
const SRC = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-push/index.ts'), 'utf8')
  .split('\n').filter((l) => !l.startsWith('import ')).join('\n');

const KEY = 'service-key';

function load({ token = null, muted = [], emailSettings = null, webUrl = null } = {}) {
  const emails = [];
  const pushes = [];
  let handler;
  const tables = {
    profiles: { expo_push_token: token },
    business_notification_prefs: { muted_groups: muted },
    business_email_settings: emailSettings,
  };
  const chain = (table) => {
    const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: tables[table] ?? null }) };
    return c;
  };
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY, BUSINESS_WEB_URL: webUrl };
  class Res { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; } json() { return JSON.parse(this.body); } }
  const fetchStub = async (url, opts) => { pushes.push({ url, body: JSON.parse(opts.body) }); return { json: async () => ({ data: { status: 'ok' } }) }; };
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'sendEmail', 'Deno', 'Response', 'fetch', SRC)(
    (h) => { handler = h; },
    () => ({ from: chain }),
    async (to, subject, text) => { emails.push({ to, subject, text }); return { sent: true }; },
    { env: { get: (k) => env[k] } },
    Res,
    fetchStub
  );
  const call = async (data, auth = `Bearer ${KEY}`) => {
    const res = await handler({
      headers: { get: () => auth },
      json: async () => ({ recipient_id: 'owner-1', title: '3 new opportunities that fit your business', body: 'Nearby matched them for you. Open to view and reply.', data }),
    });
    return { status: res.status, json: res.json() };
  };
  return { call, emails, pushes };
}

const DIGEST = { type: 'business_opportunities_digest', count: 3 };
const VERIFIED = { email: 'owner@example.com', verified_at: '2026-09-01T00:00:00Z', enabled: true };

describe('business opportunity digest: email fallback (send-push)', () => {
  it('emails a web-only owner (no push token) with a verified, enabled address', async () => {
    const t = load({ emailSettings: VERIFIED, webUrl: 'https://example.com/Nearby/business/' });
    const { status, json } = await t.call(DIGEST);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, skipped: 'no_token', emailed: true });
    expect(t.emails).toHaveLength(1);
    expect(t.emails[0].to).toBe('owner@example.com');
    expect(t.emails[0].subject).toBe('3 new opportunities that fit your business');
    expect(t.emails[0].text).toContain('Nearby matched them for you');
    expect(t.emails[0].text).toContain('https://example.com/Nearby/business/');
    expect(t.pushes).toHaveLength(0);
  });

  it('omits the dashboard link when BUSINESS_WEB_URL is not set', async () => {
    const t = load({ emailSettings: VERIFIED });
    await t.call(DIGEST);
    expect(t.emails[0].text).not.toMatch(/Open your Nearby business dashboard/);
  });

  it.each([
    ['no email on file', null],
    ['an unverified address', { ...VERIFIED, verified_at: null }],
    ['an address the owner turned off', { ...VERIFIED, enabled: false }],
  ])('does not email with %s', async (_label, emailSettings) => {
    const t = load({ emailSettings });
    const { json } = await t.call(DIGEST);
    expect(json).toMatchObject({ skipped: 'no_token', emailed: false });
    expect(t.emails).toHaveLength(0);
  });

  it('respects the owner\'s "New requests" mute for push AND email', async () => {
    const t = load({ emailSettings: VERIFIED, muted: ['requests'] });
    const { json } = await t.call(DIGEST);
    expect(json).toMatchObject({ ok: true, skipped: 'muted' });
    expect(t.emails).toHaveLength(0);
    expect(t.pushes).toHaveLength(0);
  });

  it('an owner who has a push token gets the quiet push, and no email', async () => {
    const t = load({ token: 'ExponentPushToken[abc]', emailSettings: VERIFIED });
    await t.call(DIGEST);
    expect(t.emails).toHaveLength(0);
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0].body).toMatchObject({ to: 'ExponentPushToken[abc]', sound: null, channelId: 'recommendations' });
  });

  it('control: a plain recommendation is NOT emailed, so the digest is emailed because it is an opted-in type', async () => {
    const t = load({ emailSettings: VERIFIED });
    const { json } = await t.call({ type: 'recommended_gathering' });
    expect(json.emailed).toBe(false);
    expect(t.emails).toHaveLength(0);
  });

  it('rejects a caller without the service key', async () => {
    const t = load({ emailSettings: VERIFIED });
    const { status } = await t.call(DIGEST, 'Bearer anon-key');
    expect(status).toBe(401);
    expect(t.emails).toHaveLength(0);
  });
});
