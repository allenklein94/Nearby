import fs from 'fs';
import path from 'path';

// N1 (20270347): send-push reads the device token only through push_token_for_delivery (service role); the old profiles
// column is a fallback used only while that function is missing. An Expo access token is sent only when configured.
// Runs the REAL handler with imports stubbed, as in sendPushDigestEmail.test.js.
const SRC = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-push/index.ts'), 'utf8')
  .split('\n').filter((l) => !l.startsWith('import ')).join('\n');
const KEY = 'service-key';

function load({ rpc, profileToken = null, expoAccessToken = null }) {
  const pushes = [];
  const rpcCalls = [];
  let handler;
  const chain = () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { expo_push_token: profileToken } }) }; return c; };
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY, EXPO_ACCESS_TOKEN: expoAccessToken };
  class Res { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; } json() { return JSON.parse(this.body); } }
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'sendEmail', 'Deno', 'Response', 'fetch', SRC)(
    (h) => { handler = h; },
    () => ({ from: chain, rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpc; } }),
    async () => ({ sent: false }),
    { env: { get: (k) => env[k] } },
    Res,
    async (url, opts) => { pushes.push({ headers: opts.headers, body: JSON.parse(opts.body) }); return { json: async () => ({ data: { status: 'ok' } }) }; },
  );
  const call = () => handler({ headers: { get: () => `Bearer ${KEY}` }, json: async () => ({ recipient_id: 'u1', title: 't', body: 'b', data: { type: 'message' } }) });
  return { call, pushes, rpcCalls };
}

describe('send-push token source (N1)', () => {
  it('sends to the token from push_token_for_delivery, never reading the profile column when the function answers', async () => {
    const s = load({ rpc: { data: 'ExponentPushToken[server]', error: null }, profileToken: 'ExponentPushToken[stale]' });
    await s.call();
    expect(s.rpcCalls).toEqual([{ name: 'push_token_for_delivery', args: { recipient_param: 'u1' } }]);
    expect(s.pushes).toHaveLength(1);
    expect(s.pushes[0].body.to).toBe('ExponentPushToken[server]');
  });

  it('no stored token = no push (the profile column is not consulted once the function exists)', async () => {
    const s = load({ rpc: { data: null, error: null }, profileToken: 'ExponentPushToken[stale]' });
    const res = await s.call();
    expect(s.pushes).toHaveLength(0);
    expect(res.json().skipped).toBe('no_token');
  });

  it('before the migration is live (function missing) it falls back to the profiles column', async () => {
    const s = load({ rpc: { data: null, error: { message: 'Could not find the function' } }, profileToken: 'ExponentPushToken[old]' });
    await s.call();
    expect(s.pushes[0].body.to).toBe('ExponentPushToken[old]');
  });

  it('signs the Expo send only when EXPO_ACCESS_TOKEN is set', async () => {
    const unsigned = load({ rpc: { data: 'ExponentPushToken[a]', error: null } });
    await unsigned.call();
    expect(unsigned.pushes[0].headers.Authorization).toBeUndefined();
    const signed = load({ rpc: { data: 'ExponentPushToken[a]', error: null }, expoAccessToken: 'expo-secret' });
    await signed.call();
    expect(signed.pushes[0].headers.Authorization).toBe('Bearer expo-secret');
  });
});
