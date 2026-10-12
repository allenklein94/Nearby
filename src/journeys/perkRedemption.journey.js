// Owner (2026-10-12): claiming a perk creates a code; only the business's confirmation establishes a real visit.
//   available -> the customer taps Redeem (claim: a code) -> closes and reopens the perk (the code is still there)
//   -> the business enters the code (confirm_offer_redemption) -> reopening shows "Redeemed" (only now)
// with the business's dashboard figures and the customer's perk tier read at each step: a claim counts in neither; the
// confirmed visit counts once in both. The client side is the ONE rule (utils/perkRedemptionState.js) applied to the rows
// the database actually holds, plus the card action (recommendationContext) and the code box wording. Rolled back.
// Not covered: rendering on a device (PerkCodeBox, the alerts), the realtime of a confirmation while the perk is open
// (there is none: the state is read when the perk opens), RLS itself (scripts/live-verify/confirmed-visit-counts.sql).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { perkRedemptionState, perkCodeMessage } from '../utils/perkRedemptionState';
import { recommendationContext, contextItem } from '../utils/recommendationContext';

const d = hasToken ? describe : describe.skip;

// What each surface reads when the perk opens (getMyRedemptionFor), what the dashboard says, and the customer's tier count.
const SNAP = `jsonb_build_object(
  'row', (select to_jsonb(x) from (select offer_id, confirmation_code, confirmed_at from offer_redemptions
          where user_id = v_cust and offer_id = v_o) x),
  'stats', (select to_jsonb(s) from get_business_dashboard_stats(v_p) s),
  'tier', (select count(*) from offer_redemptions where user_id = v_cust and confirmed_at is not null))`;

d('journey: perk available -> claimed (code) -> reopened (same code) -> business confirms -> Redeemed', () => {
  let s;
  beforeAll(async () => {
    const people = await runSql(`select id from profiles order by created_at limit 2;`);
    const log = await runJourney(`
      v_owner uuid := '${people[0].id}'; v_cust uuid := '${people[1].id}';
      v_p uuid := gen_random_uuid(); v_o uuid := gen_random_uuid(); v_code text; v_res jsonb; v_res2 jsonb;`, `
  insert into brand_partners (id, name, active) values (v_p, 'Coastal Coffee (journey)', true);
  insert into brand_offers (id, partner_id, title, reward_type, active, redemption_instructions)
    values (v_o, v_p, 'Free pastry', 'freebie', true, 'Ask at the counter.');
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_p where id = v_owner;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','available','ok', true, 'data', ${SNAP}));

  -- the customer taps Redeem: the claim returns the code
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  insert into offer_redemptions (offer_id, user_id) values (v_o, v_cust) returning confirmation_code into v_code;
  log := log || jsonb_build_array(jsonb_build_object('step','claimed','ok', true, 'data', ${SNAP} || jsonb_build_object('code', v_code)));

  -- closes the perk and opens it again later: the same row is read back
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','reopened','ok', true, 'data', ${SNAP}));

  -- at the counter: the business enters the code (a wrong code first, then the real one, then the real one again)
  v_res := confirm_offer_redemption('000000x');
  v_res2 := confirm_offer_redemption(v_code);
  log := log || jsonb_build_array(jsonb_build_object('step','confirmed','ok', true, 'data', ${SNAP} || jsonb_build_object(
    'wrong', v_res, 'result', v_res2, 'again', confirm_offer_redemption(v_code))));`);
    s = stepMap(log);
  }, 120000);

  const state = (k) => perkRedemptionState(s[k].data.row);
  const card = (k) => recommendationContext(contextItem('perk', { id: 'p1', title: 'Free pastry' }, { redemptionState: state(k) })).action;
  const t = (key, p = {}) => ({
    'ui.businessProfile.showStaffAtThisCode': `Show staff at ${p.name} this code to confirm: ${p.confirmationCode}`,
  }[key] ?? key);

  test('available: the Redeem button; nothing counted', () => {
    expect(state('available')).toBe('available');
    expect(card('available')).toEqual({ kind: 'redeem', label: 'Redeem' });
    expect(s.available.data.stats).toMatchObject({ total_redemptions: 0, redemptions_this_month: 0, repeat_redeemers: 0 });
    expect(s.available.data.tier).toBe(0);
  });

  test('claimed: a code, the "Your code" box (never "Redeemed"), still not counted anywhere', () => {
    const { row, code } = s.claimed.data;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(row.confirmation_code).toBe(code);
    expect(state('claimed')).toBe('claimed');
    expect(card('claimed')).toBeNull(); // the card never says Redeemed for a claim
    expect(perkCodeMessage(t, { code: row.confirmation_code, businessName: 'Coastal Coffee', instructions: 'Ask at the counter.' }))
      .toBe(`Show staff at Coastal Coffee this code to confirm: ${code}\n\nAsk at the counter.`);
    expect(s.claimed.data.stats).toMatchObject({ total_redemptions: 0, redemptions_this_month: 0 });
    expect(s.claimed.data.tier).toBe(0);
  });

  test('reopened: the same code is there again', () => {
    expect(state('reopened')).toBe('claimed');
    expect(s.reopened.data.row.confirmation_code).toBe(s.claimed.data.code);
  });

  test('the business confirms: a wrong code is refused, the real one once; then "Redeemed" and it counts once', () => {
    const c = s.confirmed.data;
    expect(c.wrong.success).toBe(false);
    expect(c.result).toMatchObject({ success: true, offerTitle: 'Free pastry' });
    expect(c.again.success).toBe(false); // the same code cannot confirm twice
    expect(state('confirmed')).toBe('confirmed');
    expect(card('confirmed')).toMatchObject({ kind: 'status', label: 'Redeemed ✓' });
    expect(c.stats).toMatchObject({ total_redemptions: 1, redemptions_this_month: 1, repeat_redeemers: 0 });
    expect(c.tier).toBe(1);
  });
});
