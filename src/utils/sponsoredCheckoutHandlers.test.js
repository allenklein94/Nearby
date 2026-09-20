import fs from 'fs';
import path from 'path';
import nodeCrypto from 'crypto';

// Runs the REAL create-sponsored-checkout and sponsored-stripe-webhook handlers (Deno imports stripped, dependencies
// injected) to prove: the live-key gates, screening + eligibility before any hold, the server-decided price, that only
// a signature-verified event can mark anything paid, idempotency, retry-on-failure and live-event refusal.
const babel = require('@babel/core');
const load = (rel) => babel.transformSync(
  fs.readFileSync(path.join(__dirname, '../../supabase/functions', rel, 'index.ts'), 'utf8')
    .split('\n').filter((l) => !l.startsWith('import ')).join('\n'),
  { filename: 'x.ts', babelrc: false, configFile: false, plugins: [['@babel/plugin-transform-typescript', { isTSX: false }]] }
).code;
const CHECKOUT_SRC = load('create-sponsored-checkout');
const WEBHOOK_SRC = load('sponsored-stripe-webhook');

class Res {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; }
  json() { return JSON.parse(this.body); }
}

function makeWebhook({ env = {}, rpcResult = {}, rpcError = {}, dupe = false } = {}) {
  const rpcs = []; const inserted = []; const deleted = []; let handler;
  const e = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', STRIPE_SPONSORED_WEBHOOK_SECRET: 'whsec_test', ...env };
  const client = {
    rpc: async (name, args) => { rpcs.push({ name, args }); return { data: rpcResult[name] ?? 'paid', error: rpcError[name] ? { message: rpcError[name] } : null }; },
    from: () => ({
      insert: async (row) => { inserted.push(row); return { error: dupe ? { message: 'duplicate' } : null }; },
      delete: () => ({ eq: async (_c, id) => { deleted.push(id); return {}; } }),
    }),
  };
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'Deno', 'Response', 'crypto', 'TextEncoder', WEBHOOK_SRC)(
    (h) => { handler = h; }, () => client, { env: { get: (k) => e[k] } }, Res, nodeCrypto.webcrypto, TextEncoder);
  const sign = (body, { ts = Math.floor(Date.now() / 1000), secret = 'whsec_test' } = {}) =>
    `t=${ts},v1=${nodeCrypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
  const send = async (event, opts = {}) => {
    const body = JSON.stringify(event);
    const res = await handler({ text: async () => body, headers: { get: () => (opts.signature ?? sign(body, opts)) } });
    return { status: res.status, text: res.body };
  };
  return { send, rpcs, inserted, deleted };
}

const paidEvent = (over = {}) => ({
  id: 'evt_1', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 2500, currency: 'usd', ...over } },
});

describe('sponsored-stripe-webhook', () => {
  it('is not configured without a signing secret (503, processes nothing)', async () => {
    const w = makeWebhook({ env: { STRIPE_SPONSORED_WEBHOOK_SECRET: undefined } });
    expect((await w.send(paidEvent())).status).toBe(503);
    expect(w.rpcs).toHaveLength(0);
  });
  it('rejects a bad signature, a wrong-secret signature and a replayed old timestamp', async () => {
    const w = makeWebhook();
    expect((await w.send(paidEvent(), { signature: 't=1,v1=abc' })).status).toBe(400);
    expect((await w.send(paidEvent(), { secret: 'whsec_other' })).status).toBe(400);
    expect((await w.send(paidEvent(), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(400);
    expect(w.rpcs).toHaveLength(0);
    expect(w.inserted).toHaveLength(0);
  });
  it('a verified paid session marks paid with the amount and currency Stripe reports', async () => {
    const w = makeWebhook();
    expect((await w.send(paidEvent())).status).toBe(200);
    expect(w.rpcs).toEqual([{ name: 'sponsored_mark_paid', args: { session_id_param: 'cs_test_1', payment_intent_param: 'pi_1', amount_total_param: 2500, currency_param: 'usd' } }]);
  });
  it('an unpaid (pending async) session does not mark paid', async () => {
    const w = makeWebhook();
    await w.send(paidEvent({ payment_status: 'unpaid' }));
    expect(w.rpcs).toHaveLength(0);
  });
  it('async success marks paid; async failure and expiry release the slot', async () => {
    let w = makeWebhook();
    await w.send({ ...paidEvent(), type: 'checkout.session.async_payment_succeeded' });
    expect(w.rpcs[0].name).toBe('sponsored_mark_paid');
    w = makeWebhook();
    await w.send({ ...paidEvent(), type: 'checkout.session.async_payment_failed' });
    expect(w.rpcs[0]).toEqual({ name: 'sponsored_mark_unpaid', args: { session_id_param: 'cs_test_1', failed_param: true } });
    w = makeWebhook();
    await w.send({ ...paidEvent(), type: 'checkout.session.expired' });
    expect(w.rpcs[0]).toEqual({ name: 'sponsored_mark_unpaid', args: { session_id_param: 'cs_test_1', failed_param: false } });
  });
  it('refunds and disputes stop serving through the database', async () => {
    let w = makeWebhook();
    await w.send({ id: 'evt_r', type: 'charge.refunded', livemode: false, data: { object: { payment_intent: 'pi_1', amount_refunded: 1000 } } });
    expect(w.rpcs[0]).toEqual({ name: 'sponsored_mark_refunded', args: { payment_intent_param: 'pi_1', refunded_cents_param: 1000 } });
    w = makeWebhook();
    await w.send({ id: 'evt_d', type: 'charge.dispute.created', livemode: false, data: { object: { payment_intent: 'pi_1' } } });
    expect(w.rpcs[0]).toEqual({ name: 'sponsored_mark_disputed', args: { payment_intent_param: 'pi_1' } });
  });
  it('a duplicate event id is acknowledged and not processed again', async () => {
    const w = makeWebhook({ dupe: true });
    const r = await w.send(paidEvent());
    expect(r.status).toBe(200);
    expect(w.rpcs).toHaveLength(0);
  });
  it('a processing failure removes the dedupe marker and returns 500 so Stripe retries (a paid event is never dropped)', async () => {
    const w = makeWebhook({ rpcError: { sponsored_mark_paid: 'boom' } });
    expect((await w.send(paidEvent())).status).toBe(500);
    expect(w.deleted).toEqual(['evt_1']);
  });
  it('ignores event types it does not handle', async () => {
    const w = makeWebhook();
    expect((await w.send({ id: 'evt_x', type: 'customer.created', livemode: false, data: { object: {} } })).status).toBe(200);
    expect(w.rpcs).toHaveLength(0);
  });
  it('refuses a live-mode event unless BOTH live approvals are set', async () => {
    const ev = { ...paidEvent(), livemode: true };
    let w = makeWebhook();
    expect((await w.send(ev)).status).toBe(503);
    w = makeWebhook({ env: { STRIPE_LIVE_APPROVED: 'true' } });
    expect((await w.send(ev)).status).toBe(503);
    w = makeWebhook({ env: { STRIPE_LIVE_APPROVED: 'true', SPONSORED_LEGAL_REVIEW_COMPLETE: 'true' } });
    expect((await w.send(ev)).status).toBe(200);
    expect(w.rpcs).toHaveLength(1);
  });
});

function makeCheckout({ env = {}, check = { ok: true }, classify = { riskTier: 'low' }, begin = null, stripe = null } = {}) {
  const rpcs = []; const stripeCalls = []; let handler; let classifyCalls = 0;
  const e = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon',
    STRIPE_SECRET_KEY: 'sk_test_123', ...env,
  };
  const purchase = begin ?? { data: [{ placement_id: 'pl_1', payment_id: 'pay_1', amount_cents: 2500, currency: 'usd' }], error: null };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      if (name === 'check_my_sponsored_slot') return { data: check, error: null };
      if (name === 'sponsored_begin_purchase') return purchase;
      return { data: null, error: null };
    },
  };
  const fetchStub = async (url, opts) => {
    stripeCalls.push({ url, opts });
    const r = stripe ?? { ok: true, body: { id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9', expires_at: 999 } };
    return { ok: r.ok, status: r.ok ? 200 : 400, json: async () => r.body };
  };
  // eslint-disable-next-line no-new-func
  new Function('serve', 'createClient', 'classifyContent', 'Deno', 'Response', 'fetch', CHECKOUT_SRC)(
    (h) => { handler = h; }, () => client, async () => { classifyCalls += 1; return classify; },
    { env: { get: (k) => e[k] } }, Res, fetchStub);
  const tomorrow = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const call = async (body = {}, auth = 'Bearer tok') => {
    const res = await handler({
      headers: { get: () => auth },
      json: async () => ({ itemKind: 'business', startDate: tomorrow(), title: 'Fresh pastries', description: 'Baked daily', ...body }),
    });
    return { status: res.status, json: res.json() };
  };
  return { call, rpcs, stripeCalls, classifyCalls: () => classifyCalls };
}

describe('create-sponsored-checkout', () => {
  it('needs a Stripe key (503)', async () => {
    const t = makeCheckout({ env: { STRIPE_SECRET_KEY: undefined } });
    expect((await t.call()).status).toBe(503);
  });
  it('refuses a live key unless BOTH live approvals are set by the owner', async () => {
    const live = { STRIPE_SECRET_KEY: 'sk_live_abc' };
    expect((await makeCheckout({ env: live }).call()).status).toBe(503);
    expect((await makeCheckout({ env: { ...live, STRIPE_LIVE_APPROVED: 'true' } }).call()).status).toBe(503);
    expect((await makeCheckout({ env: { ...live, SPONSORED_LEGAL_REVIEW_COMPLETE: 'true' } }).call()).status).toBe(503);
    expect((await makeCheckout({ env: { ...live, STRIPE_LIVE_APPROVED: 'true', SPONSORED_LEGAL_REVIEW_COMPLETE: 'true' } }).call()).status).toBe(200);
  });
  it('requires a session', async () => {
    const t = makeCheckout();
    expect((await t.call({}, null)).status).toBe(401);
  });
  it('validates the start date and text before anything else happens', async () => {
    const t = makeCheckout();
    expect((await t.call({ startDate: 'tomorrow' })).status).toBe(422);
    expect((await t.call({ startDate: '2026-02-31' })).status).toBe(422);
    expect((await t.call({ title: '' })).status).toBe(422);
    expect((await t.call({ title: 'x'.repeat(81) })).status).toBe(422);
    expect((await t.call({ description: 'x'.repeat(201) })).status).toBe(422);
    expect(t.rpcs).toHaveLength(0);
    expect(t.classifyCalls()).toBe(0);
  });
  it('an ineligible or taken slot stops before screening, a hold or Stripe', async () => {
    const t = makeCheckout({ check: { ok: false, problem: 'slot_taken' } });
    const r = await t.call();
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('slot_taken');
    expect(t.classifyCalls()).toBe(0);
    expect(t.rpcs.map((x) => x.name)).toEqual(['check_my_sponsored_slot']);
    expect(t.stripeCalls).toHaveLength(0);
  });
  it('an empty allow-list category cannot buy', async () => {
    const t = makeCheckout({ check: { ok: false, problem: 'category_not_sponsorable' } });
    expect((await t.call()).status).toBe(409);
    expect(t.stripeCalls).toHaveLength(0);
  });
  it('a screening service failure fails closed (503) with no hold and no Stripe call', async () => {
    const t = makeCheckout({ classify: null });
    const r = await t.call();
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('screening_unavailable');
    expect(t.rpcs.map((x) => x.name)).toEqual(['check_my_sponsored_slot']);
    expect(t.stripeCalls).toHaveLength(0);
  });
  it('text that is not clean is refused with no hold and no Stripe call', async () => {
    const t = makeCheckout({ classify: { riskTier: 'medium' } });
    expect((await t.call()).status).toBe(422);
    expect(t.rpcs.map((x) => x.name)).toEqual(['check_my_sponsored_slot']);
    expect(t.stripeCalls).toHaveLength(0);
  });
  it('happy path: hold with the screened tier, server-decided price, test session, then attach', async () => {
    const t = makeCheckout();
    const r = await t.call({ amount: 1, price: 1, unit_amount: 1, successUrl: 'https://evil.example' });
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const begin = t.rpcs.find((x) => x.name === 'sponsored_begin_purchase');
    expect(begin.args.screening_tier_param).toBe('low');
    expect(begin.args.user_id_param).toBe('user-1');
    const call = t.stripeCalls[0];
    expect(call.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const form = decodeURIComponent(call.opts.body);
    expect(form).toContain('mode=payment');
    expect(form).toContain('line_items[0][price_data][unit_amount]=2500'); // the database price, not the client's
    expect(form).toContain('line_items[0][price_data][currency]=usd');
    expect(form).toContain('client_reference_id=pay_1');
    expect(form).not.toContain('evil.example');
    expect(form).toMatch(/success_url=https:\/\/allenklein94\.github\.io\/Nearby\/business\/\?sponsored=success/);
    expect(call.opts.headers['Idempotency-Key']).toBe('sponsored-pay_1');
    const exp = Number(/expires_at=(\d+)/.exec(form)[1]);
    expect(exp - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(30 * 60); // Stripe's minimum
    expect(t.rpcs.at(-1)).toEqual({ name: 'sponsored_attach_checkout_session', args: { payment_id_param: 'pay_1', session_id_param: 'cs_test_9' } });
  });
  it('a Stripe failure releases the hold, says nothing was charged, and never marks anything paid', async () => {
    const t = makeCheckout({ stripe: { ok: false, body: { error: { message: 'bad' } } } });
    const r = await t.call();
    expect(r.status).toBe(502);
    expect(r.json.error).toMatch(/not been charged/);
    expect(t.rpcs.map((x) => x.name)).toContain('sponsored_release_hold');
    expect(t.rpcs.map((x) => x.name)).not.toContain('sponsored_attach_checkout_session');
    expect(t.rpcs.map((x) => x.name).some((n) => /mark_paid/.test(n))).toBe(false);
  });
  it('maps a database refusal (slot taken between check and hold) to a clear message', async () => {
    const t = makeCheckout({ begin: { data: null, error: { message: 'sponsored:slot_taken' } } });
    const r = await t.call();
    expect(r.status).toBe(409);
    expect(t.stripeCalls).toHaveLength(0);
  });
  it('the source never writes paid status', () => {
    expect(CHECKOUT_SRC).not.toMatch(/mark_paid|status:\s*'paid'|\.update\(/);
  });
});
