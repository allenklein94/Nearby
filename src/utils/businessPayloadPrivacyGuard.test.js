const fs = require('fs');
const path = require('path');

// Standing convention: business-facing payloads contain only the minimum needed to evaluate, offer on, and fulfill a
// specific request. These guards keep consumer free text, profile-derived interests and internal ids from crossing the
// boundary into what a business receives (opportunity RPC, pushes to a business, the dashboard).
const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261221_business_payload_minimization.sql'), 'utf8');
const parts = mig.split(/create or replace function/i).slice(1);
const fn = (name) => {
  const body = parts.find((p) => new RegExp(`^\\s+public\\.${name}\\(`, 'i').test(p));
  expect(body).toBeDefined();
  expect(body.length).toBeGreaterThan(200); // never assert against an empty slice
  return body;
};

describe('get_business_opportunities payload', () => {
  const body = fn('get_business_opportunities');
  const built = body.slice(body.indexOf('jsonb_build_object('), body.indexOf(') as business_requests'));
  it.each(['raw_text', 'shared_interests', 'match_id', 'gathering_id', 'plan_label', 'requester_id'])('never returns %s', (col) => {
    expect(built).not.toMatch(new RegExp(`'${col}'`));
    expect(built).not.toMatch(new RegExp(`br\\.${col}\\b(?!\\s+is (not )?null)`));
  });
  it('keeps the operational fields the business needs', () => {
    for (const k of ['summary', 'occasion', 'category', 'party_size', 'budget_min', 'budget_max', 'date', 'time_window_start', 'attributes', 'cuisine', 'is_match_request']) {
      expect(built).toMatch(new RegExp(`'${k}'`));
    }
  });
  it('still authorizes by managed partner', () => {
    expect(body).toMatch(/managed_partner_id\s*=\s*partner_id_param/i);
    expect(mig).toMatch(/revoke all on function public\.get_business_opportunities\(uuid\) from public, anon/);
  });
});

describe('the business-safe summary', () => {
  const body = fn('business_safe_request_summary');
  it('is built only from structured columns', () => {
    expect(body).not.toMatch(/raw_text|shared_interests|plan_label|display_name/);
    for (const c of ['occasion', 'category', 'party_size', 'date']) expect(body).toMatch(new RegExp(`br\\.${c}\\b`));
  });
  it('is not callable by clients', () => {
    expect(mig).toMatch(/revoke all on function public\.business_safe_request_summary\(uuid\) from public, anon, authenticated/);
  });
});

describe('pushes to a business never carry the consumer text', () => {
  it.each(['_business_request_fanout', '_ai_auto_respond_to_business_requests', 'accept_business_offer', 'cancel_business_reservation'])('%s', (name) => {
    const body = fn(name);
    const businessBodies = body.match(/'body',[^\n]*/g) ?? [];
    expect(body).toMatch(/business_safe_request_summary/);
    // the only remaining raw_text uses in these bodies are consumer-addressed pushes (cancel), never a business body
    for (const line of businessBodies) {
      if (/customer|New request|auto-sent/i.test(line)) expect(line).not.toMatch(/raw_text/);
    }
  });
});

describe('client does not read or collect what a business must not receive', () => {
  const dash = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
  it('dashboard reads neither raw_text nor shared_interests nor request ids', () => {
    expect(dash).not.toMatch(/business_requests\??\.raw_text|br\??\.raw_text/);
    expect(dash).not.toMatch(/shared_interests/);
    expect(dash).not.toMatch(/br\??\.(match_id|gathering_id)/);
  });
  it('ask-a-business screen no longer offers to share interests or a free-text note with businesses', () => {
    const ask = fs.readFileSync(path.join(__dirname, '../screens/AskBusinessScreen.js'), 'utf8');
    expect(ask).not.toMatch(/sharedInterests|Share my interests with businesses|Anything else\?/);
  });
});

describe('the Stripe PaymentIntent (created on the business\'s connected account) never carries consumer text', () => {
  const edge = fs.readFileSync(path.join(__dirname, '../../supabase/functions/create-business-payment-intent/index.ts'), 'utf8');
  it('does not read or send raw_text, and uses the business-safe summary', () => {
    expect(edge).not.toMatch(/raw_text|shared_interests|plan_label/);
    expect(edge).toMatch(/business_safe_request_summary/);
    expect(edge).toMatch(/description,\n/);
  });
  it('service role can call the helper explicitly', () => {
    const g = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261224_summary_helper_service_role.sql'), 'utf8');
    expect(g).toMatch(/grant execute on function public\.business_safe_request_summary\(uuid\) to service_role/);
  });
});
