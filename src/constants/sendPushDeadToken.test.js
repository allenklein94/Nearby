import fs from 'fs';
import path from 'path';

// Runs the REAL send-push handler (imports stubbed, like sendPushDigestEmail.test.js) through the dead-token paths of
// 20270421: a send Expo refuses as DeviceNotRegistered, an accepted send being recorded, and the receipt check.
const SRC = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-push/index.ts'), 'utf8')
  .split('\n').filter((l) => !l.startsWith('import ')).join('\n');
const KEY = 'service-key';
const VERIFIED = { email: 'owner@example.com', verified_at: '2026-09-01T00:00:00Z', enabled: true };
const RID = '11111111-2222-4333-8444-555555555555';

function load({ token = 'ExponentPushToken[old]', emailSettings = VERIFIED, ticket = { status: 'ok', id: 't-1' },
  receipts = {}, due = [], settle = () => null, receiptsStatus = 200, installed = true } = {}) {
  const emails = [];
  const fetches = [];
  const rpcs = [];
  let handler;
  const chain = () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: emailSettings }) }; return c; };
  const rpc = async (name, args) => {
    rpcs.push({ name, args });
    if (name === 'push_token_for_delivery') return { data: token, error: null };
    if (!installed) return { data: null, error: { code: 'PGRST202' } };
    if (name === '_push_receipts_due') return { data: due.map((ticket_id) => ({ ticket_id })), error: null };
    if (name === '_settle_push_receipt') return { data: settle(args), error: null };
    if (name === '_invalidate_push_token') return { data: true, error: null };
    return { data: null, error: null };
  };
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY, BUSINESS_WEB_URL: 'https://example.com/Nearby/business/' };
  class Res { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; } json() { return JSON.parse(this.body); } }
  const fetchStub = async (url, opts) => {
    fetches.push({ url, body: JSON.parse(opts.body) });
    if (url.endsWith('/getReceipts')) return { ok: receiptsStatus === 200, status: receiptsStatus, json: async () => ({ data: receipts }) };
    return { json: async () => ({ data: ticket }) };
  };
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'sendEmail', 'Deno', 'Response', 'fetch', 'secretKey', SRC)(
    (h) => { handler = h; },
    () => ({ from: chain, rpc }),
    async (to, subject, text) => { emails.push({ to, subject, text }); return { sent: true }; },
    { env: { get: (k) => env[k] } },
    Res,
    fetchStub,
    () => KEY,
  );
  const call = async (body) => {
    const res = await handler({ headers: { get: () => `Bearer ${KEY}` }, json: async () => body });
    return { status: res.status, json: res.json() };
  };
  const push = (data, extra = {}) => call({ recipient_id: 'owner-1', title: 'New request', body: 'Coffee for 2 today', data, ...extra });
  return { call, push, emails, fetches, rpcs };
}

const ALERT = { type: 'business_opportunity_received', request_id: RID };
const SOCIAL = { type: 'message' };

describe('a send Expo refuses as DeviceNotRegistered', () => {
  it('clears that token and emails the business alert once, now', async () => {
    const t = load({ ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } });
    const { json } = await t.push(ALERT);
    expect(json).toMatchObject({ ok: true, tokenCleared: true, emailed: true });
    expect(t.rpcs.find((r) => r.name === '_invalidate_push_token').args).toEqual({ recipient_id_param: 'owner-1', token_param: 'ExponentPushToken[old]' });
    expect(t.emails).toHaveLength(1);
    expect(t.emails[0].text).toContain(`Open this request: https://example.com/Nearby/business/?n=business_opportunity_received&r=${RID}`);
    expect(t.rpcs.some((r) => r.name === '_record_push_ticket')).toBe(false);
  });
  it('a personal push clears the dead token but is never emailed to the business address', async () => {
    const t = load({ ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } });
    const { json } = await t.push(SOCIAL);
    expect(json.tokenCleared).toBe(true);
    expect(t.emails).toHaveLength(0);
  });
  it('any other refusal (rate limit, too big, credentials) clears nothing and emails nothing', async () => {
    for (const error of ['MessageRateExceeded', 'MessageTooBig', 'InvalidCredentials', undefined]) {
      const t = load({ ticket: { status: 'error', details: { error } } });
      await t.push(ALERT);
      expect(t.rpcs.some((r) => r.name === '_invalidate_push_token')).toBe(false);
      expect(t.emails).toHaveLength(0);
    }
  });
});

describe('an accepted send is recorded for the receipt check', () => {
  it('a business alert keeps its own words (for one later email), a personal push only the ticket', async () => {
    const a = load();
    await a.push(ALERT);
    expect(a.rpcs.find((r) => r.name === '_record_push_ticket').args).toEqual({
      ticket_id_param: 't-1', recipient_id_param: 'owner-1', token_param: 'ExponentPushToken[old]',
      email_title_param: 'New request', email_body_param: 'Coffee for 2 today',
      email_data_param: { type: 'business_opportunity_received', request_id: RID },
    });
    const p = load();
    await p.push(SOCIAL);
    expect(p.rpcs.find((r) => r.name === '_record_push_ticket').args).toMatchObject({ email_title_param: null, email_body_param: null, email_data_param: null });
    expect(a.emails).toHaveLength(0);
  });
  it('a customer-message alert keeps its message (and location) id, so the later dead-device email opens that conversation', async () => {
    const MID = '99999999-8888-4777-8666-555555555555';
    const PID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const MSG = { type: 'business_message_received', message_id: MID, partner_id: PID };
    const a = load();
    await a.push(MSG, { title: 'New message for Coastal Coffee', body: 'Open Nearby to read and reply.' });
    const stored = a.rpcs.find((r) => r.name === '_record_push_ticket').args.email_data_param;
    expect(stored).toEqual({ type: 'business_message_received', request_id: null, message_id: MID, partner_id: PID });
    const t = load({ due: ['t-dead'], receipts: { 't-dead': { status: 'error', details: { error: 'DeviceNotRegistered' } } },
      settle: () => ({ invalidated: true, recipient_id: 'owner-1', email: { title: 'New message for Coastal Coffee', body: 'Open Nearby to read and reply.', data: stored } }) });
    await t.call({ action: 'check_receipts' });
    expect(t.emails).toHaveLength(1);
    expect(t.emails[0].text).toContain(`Open this conversation: https://example.com/Nearby/business/?n=business_message_received&r=${MID}&b=${PID}`);
  });
  it('before 20270421 is live the push still answers as before', async () => {
    const t = load({ installed: false });
    const { status, json } = await t.push(ALERT);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, result: { data: { status: 'ok', id: 't-1' } } });
  });
});

describe('the receipt check', () => {
  const dead = { status: 'error', details: { error: 'DeviceNotRegistered' } };
  it('settles each due ticket by what Expo says; a dead device is emailed once', async () => {
    const settled = [];
    const t = load({
      due: ['t-dead', 't-ok', 't-other', 't-missing'],
      receipts: { 't-dead': dead, 't-ok': { status: 'ok' }, 't-other': { status: 'error', details: { error: 'MessageRateExceeded' } } },
      settle: ({ ticket_id_param, outcome_param }) => {
        settled.push([ticket_id_param, outcome_param]);
        return outcome_param === 'device_not_registered'
          ? { invalidated: true, recipient_id: 'owner-1', email: { title: 'New request', body: 'Coffee for 2 today', data: ALERT } } : null;
      },
    });
    const { json } = await t.call({ action: 'check_receipts' });
    expect(json).toEqual({ ok: true, checked: 4, invalidated: 1, emailed: 1 });
    expect(settled).toEqual([['t-dead', 'device_not_registered'], ['t-ok', 'ok'], ['t-other', 'other_error'], ['t-missing', 'pending']]);
    expect(t.fetches[0]).toMatchObject({ url: 'https://exp.host/--/api/v2/push/getReceipts', body: { ids: ['t-dead', 't-ok', 't-other', 't-missing'] } });
    expect(t.emails).toHaveLength(1);
  });
  it('a ticket another run already settled sends nothing (the database hands it out once)', async () => {
    const t = load({ due: ['t-dead'], receipts: { 't-dead': dead }, settle: () => null });
    const { json } = await t.call({ action: 'check_receipts' });
    expect(json).toMatchObject({ checked: 1, invalidated: 0, emailed: 0 });
    expect(t.emails).toHaveLength(0);
  });
  it('Expo down or refusing = nothing settled, asked again next time', async () => {
    const t = load({ due: ['t-dead'], receiptsStatus: 503 });
    const { json } = await t.call({ action: 'check_receipts' });
    expect(json).toEqual({ ok: true, checked: 0, error: 'expo_503' });
    expect(t.rpcs.some((r) => r.name === '_settle_push_receipt')).toBe(false);
  });
  it('nothing due = no call to Expo', async () => {
    const t = load({ due: [] });
    expect((await t.call({ action: 'check_receipts' })).json).toEqual({ ok: true, checked: 0 });
    expect(t.fetches).toHaveLength(0);
  });
  it('only the service key may ask', async () => {
    const t = load({ due: ['t-1'] });
    const fn = SRC; // the auth check runs before the action is read
    expect(fn.indexOf("payload?.action === 'check_receipts'")).toBeGreaterThan(fn.indexOf('if (authHeader !== expectedAuth)'));
    expect(t.fetches).toHaveLength(0);
  });
});
