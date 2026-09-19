// max_discount_pct must stay enforced at the database chokepoint (migration 20261230) and be
// carried by every client/edge path that can state a discount. DB behavior itself is proven by
// scripts/live-verify/max-discount-cap-enforcement.js (needs a live project).
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('max_discount_pct enforcement wiring', () => {
  const mig = read('supabase/migrations/20261230_enforce_max_discount_pct.sql');
  it('a trigger on business_request_offers is the single chokepoint', () => {
    expect(mig).toMatch(/create trigger business_request_offers_enforce_discount_cap\s+before insert or update on public\.business_request_offers/);
    expect(mig).toMatch(/_discount_cap_violation\(NEW\.partner_id, NEW\.offer_type, NEW\.discount_pct\)/);
  });
  it('reads only an ACTIVE policy, so a null/absent cap keeps the old unlimited behavior', () => {
    expect(mig).toMatch(/where partner_id = partner_id_param and active/);
    expect(mig).toMatch(/if v_cap is null then\s+return null;/);
  });
  it('both RPCs and the screening approval carry discount_pct', () => {
    expect(mig).toMatch(/discount_pct = discount_pct_param/);
    expect(mig).toMatch(/discountPct/);
    expect(mig).toMatch(/drop function if exists public\.submit_business_offer/);
    expect(mig).toMatch(/drop function if exists public\.post_business_availability/);
  });
  it('the helper stays off the client roles', () => {
    expect(mig).toMatch(/revoke all on function public\._discount_cap_violation\(uuid, text, numeric\) from public, anon, authenticated/);
  });
  it('the edge function pre-checks and forwards discountPct on both branches', () => {
    const fn = read('supabase/functions/screen-business-content/index.ts');
    expect((fn.match(/_discount_cap_violation/g) || []).length).toBe(2);
    expect((fn.match(/discount_pct_param: discountPct/g) || []).length).toBe(4);
  });
  it('the client service forwards discountPct to all four calls', () => {
    const svc = read('src/services/businessFulfillment.js');
    expect((svc.match(/discountPct/g) || []).length).toBeGreaterThanOrEqual(8);
  });
});
