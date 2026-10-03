// Item 150: the business funnel (Opportunities -> Offers sent -> Offers accepted -> Redemptions + redeemed value).
const fs = require('fs');
const path = require('path');
import { offerFunnelView } from './offerFunnel';

const funnel = { opportunities: 25, offers_sent: 14, accepted: 8, redemptions: 6 };

describe('offerFunnelView', () => {
  test('one row per stage, in funnel order, with the real counts', () => {
    const v = offerFunnelView(funnel, null);
    expect(v.title).toBe('This month');
    expect(v.stages.map((s) => [s.label, s.count])).toEqual([
      ['Opportunities', 25], ['Offers sent', 14], ['Offers accepted', 8], ['Redemptions', 6],
    ]);
    expect(v.valueRow).toBeNull();
    expect(v.note).toBeNull();
  });

  test('the value row comes from the redeemed offers, labelled as value, never revenue', () => {
    const v = offerFunnelView(funnel, { month_redemptions: 6, month_value: 120, month_unpriced: 0 });
    expect(v.valueRow).toEqual({ key: 'value', label: 'Value of offers redeemed', amount: '$120' });
    expect(v.note).toBe('Based on the prices you set on your offers. Not a measure of what customers spent.');
  });

  test('unpriced redemptions are said, never guessed', () => {
    const v = offerFunnelView(funnel, { month_redemptions: 6, month_value: 80, month_unpriced: 2 });
    expect(v.valueRow.amount).toBe('$80');
    expect(v.note).toMatch(/2/);
  });

  test('no priced redemption = no value row (no invented $0)', () => {
    expect(offerFunnelView(funnel, { month_redemptions: 0, month_value: 0, month_unpriced: 0 }).valueRow).toBeNull();
    expect(offerFunnelView(funnel, { month_redemptions: 2, month_value: 0, month_unpriced: 2 }).valueRow).toBeNull();
  });

  test('a quiet month shows real zeros once loaded', () => {
    const v = offerFunnelView({ opportunities: 0, offers_sent: 0, accepted: 0, redemptions: 0 }, null);
    expect(v.stages.map((s) => s.count)).toEqual([0, 0, 0, 0]);
  });

  test('a failed or partial load shows nothing rather than invented numbers', () => {
    expect(offerFunnelView(null, null)).toBeNull();
    expect(offerFunnelView({ opportunities: 3 }, null)).toBeNull();
    expect(offerFunnelView({ ...funnel, accepted: -1 }, null)).toBeNull();
  });
});

describe('item 150 wiring', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

  test('the funnel wording never says revenue or earnings', () => {
    const en = JSON.parse(read('scripts/i18n/strings/bizHelp.json')).en;
    Object.entries(en).filter(([k]) => k.startsWith('funnel.')).forEach(([, v]) => expect(v).not.toMatch(/revenue|earning|income|profit/i));
  });

  test('the dashboard reads the server funnel and shows the one block (no second "This month" redemptions line)', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    expect(src).toMatch(/getPartnerOfferFunnel\(partnerId\)\.then\(setOfferFunnel\)/);
    expect(src).toMatch(/offerFunnelView\(offerFunnel, offerValue\)/);
    expect(src).not.toMatch(/offerValueLines\(/);
  });

  test('the server counts each stage from real records, and a decline is never an offer sent', () => {
    const sql = read('supabase/migrations/20270268_partner_offer_funnel.sql');
    expect(sql).toMatch(/to_status = 'offered'/);
    expect(sql).toMatch(/o\.status = 'completed' and o\.completed_at >= v_start/);
    expect(sql).toMatch(/managed_partner_id = partner_id_param/);
    expect(sql).toMatch(/revoke all on function public\.get_partner_offer_funnel\(uuid\) from public, anon/);
  });
});
