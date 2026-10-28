import fs from 'fs';
import path from 'path';

// Item 62: replies to ONE request replace each other on the phone. Runs the REAL send-push handler (imports stubbed, as in
// sendPushDigestEmail.test.js) and checks the Expo message it builds: a reply push with collapse_key 'offers:<request id>'
// carries collapseId (iOS) AND tag (Android) = that key; every other push carries neither.
const SRC = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-push/index.ts'), 'utf8')
  .split('\n').filter((l) => !l.startsWith('import ')).join('\n');
const KEY = 'service-key';
const REQ = '3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f60718';
const REQ2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function load() {
  const pushes = [];
  let handler;
  const chain = () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { expo_push_token: 'ExponentPushToken[x]' } }) }; return c; };
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY };
  class Res { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; } json() { return JSON.parse(this.body); } }
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'sendEmail', 'Deno', 'Response', 'fetch', 'secretKey', SRC)(
    (h) => { handler = h; },
    // Pre-20270347 path: the function is missing, so the token comes from the profiles column.
    () => ({ from: chain, rpc: async () => ({ data: null, error: { message: 'function not found' } }) }),
    async () => ({ sent: false }),
    { env: { get: (k) => env[k] } },
    Res,
    async (url, opts) => { pushes.push(JSON.parse(opts.body)); return { json: async () => ({ data: { status: 'ok' } }) }; },
    () => env.SUPABASE_SERVICE_ROLE_KEY, // _shared/supabaseKeys.ts (legacy-named fallback path)
  );
  const call = (data) => handler({ headers: { get: () => `Bearer ${KEY}` }, json: async () => ({ recipient_id: 'u1', title: 't', body: 'b', data }) });
  return { call, pushes };
}

describe('send-push: reply pushes replace in place per request (item 62)', () => {
  it('a reply push carries collapseId (iOS) and tag (Android) = its request key', async () => {
    const t = load();
    await t.call({ type: 'business_offer_received', request_id: REQ, offer_id: 'o1', collapse_key: `offers:${REQ}` });
    expect(t.pushes[0]).toMatchObject({ collapseId: `offers:${REQ}`, tag: `offers:${REQ}`, categoryId: 'nearby_view_offer' });
  });
  it('two requests get two different keys (never replace each other)', async () => {
    const t = load();
    await t.call({ type: 'business_offer_received', request_id: REQ, collapse_key: `offers:${REQ}` });
    await t.call({ type: 'business_offer_received', request_id: REQ2, collapse_key: `offers:${REQ2}` });
    expect(t.pushes.map((p) => p.tag)).toEqual([`offers:${REQ}`, `offers:${REQ2}`]);
  });
  it.each([
    ['no key (every other push)', { type: 'plan_message', plan_id: 'p' }],
    ['an older reply push queued before the change', { type: 'business_offer_received', request_id: REQ, offer_id: 'o1' }],
    ['a malformed key', { type: 'business_offer_received', request_id: REQ, collapse_key: 'offers:*' }],
    ['a key of another shape', { type: 'plan_message', collapse_key: `plan:${REQ}` }],
  ])('%s: neither collapseId nor tag', async (_l, data) => {
    const t = load();
    await t.call(data);
    expect(t.pushes[0]).not.toHaveProperty('collapseId');
    expect(t.pushes[0]).not.toHaveProperty('tag');
  });
});
