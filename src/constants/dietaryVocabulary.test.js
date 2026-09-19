const fs = require('fs');
const path = require('path');
const { DIETARY_OPTIONS, dietaryLabel } = require('./businessAttributes');

const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261223_business_request_dietary.sql'), 'utf8');
const dbList = (re) => [...mig.match(re)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe('dietary vocabulary', () => {
  it('client list matches the DB CHECK, the RPC validation, exactly', () => {
    const keys = DIETARY_OPTIONS.map((o) => o.key).sort();
    expect(dbList(/check \(dietary <@ array\[([^\]]*)\]/).sort()).toEqual(keys);
    expect(dbList(/not dietary_param <@ array\[([^\]]*)\]/).sort()).toEqual(keys);
  });
  it('is a closed vocabulary with labels, no free text', () => {
    for (const o of DIETARY_OPTIONS) expect(dietaryLabel(o.key)).toBe(o.label);
    expect(DIETARY_OPTIONS.length).toBeLessThanOrEqual(8);
  });
  it('reaches a business only via the opportunity RPC, and never via the summary or pushes', () => {
    const summary = mig.split(/create or replace function/i).find((p) => /business_safe_request_summary/.test(p) && !/get_business_opportunities/.test(p));
    expect(summary ?? '').not.toMatch(/dietary/);
    expect(mig).toMatch(/'dietary', case when cardinality\(br\.dietary\) > 0/);
    expect(mig).not.toMatch(/'body',[^\n]*dietary/i);
  });
  it('the AI never fills it: assistants do not mention dietary', () => {
    for (const f of ['create-assistant', 'business-onboarding-assistant']) {
      expect(fs.readFileSync(path.join(__dirname, `../../supabase/functions/${f}/index.ts`), 'utf8')).not.toMatch(/dietary/i);
    }
  });
});
