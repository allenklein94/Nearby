// Owner (2026-10-12): claiming a perk creates a code; only the business's confirmation establishes a real visit.
const fs = require('fs');
const path = require('path');
import { perkRedemptionState, redemptionsByOffer, perkCodeMessage, PERK_REDEMPTION_STATES } from './perkRedemptionState';
import en from '../i18n/ui/businessProfile';

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
const code = (r) => read(r).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// A tiny t() over the real English strings the helper reuses.
const STRINGS = {
  'ui.businessProfile.showStaffAtThisCode': 'Show staff at {name} this code to confirm: {confirmationCode}',
  'ui.brandOffersUi.showStaffCode': 'Show staff this code to confirm: {code}\n\n{instructions}',
};
const t = (k, p = {}) => (STRINGS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => (p[n] ?? ''));

describe('the one state rule', () => {
  test('available -> claimed -> confirmed, from the viewer\'s own row only', () => {
    expect(PERK_REDEMPTION_STATES).toEqual(['available', 'claimed', 'confirmed']);
    expect(perkRedemptionState(null)).toBe('available');
    expect(perkRedemptionState(undefined)).toBe('available');
    expect(perkRedemptionState({ offer_id: 'o1', confirmation_code: '012345', confirmed_at: null })).toBe('claimed');
    expect(perkRedemptionState({ offer_id: 'o1', confirmation_code: '012345' })).toBe('claimed');
    expect(perkRedemptionState({ offer_id: 'o1', confirmation_code: '012345', confirmed_at: '2026-10-12T15:00:00Z' })).toBe('confirmed');
  });
  test('rows keyed by offer; junk ignored', () => {
    const rows = [{ offer_id: 'a', confirmation_code: '1', confirmed_at: null }, null, { confirmation_code: 'x' }, { offer_id: 'b', confirmation_code: '2', confirmed_at: 'z' }];
    const by = redemptionsByOffer(rows);
    expect(Object.keys(by).sort()).toEqual(['a', 'b']);
    expect(perkRedemptionState(by.a)).toBe('claimed');
    expect(perkRedemptionState(by.b)).toBe('confirmed');
    expect(redemptionsByOffer(null)).toEqual({});
  });
});

describe('what the code box says', () => {
  test('names the business when known (existing ui.businessProfile.showStaffAtThisCode)', () => {
    expect(perkCodeMessage(t, { code: '012345', businessName: 'Coastal Coffee' })).toBe('Show staff at Coastal Coffee this code to confirm: 012345');
    expect(en.en.showStaffAtThisCode).toBe(STRINGS['ui.businessProfile.showStaffAtThisCode']);
  });
  test('without a name: the plain staff line, no dangling blank lines', () => {
    expect(perkCodeMessage(t, { code: '012345', businessName: '  ' })).toBe('Show staff this code to confirm: 012345');
  });
  test('business-written instructions only when they exist; never the dead "check your account" fallback', () => {
    expect(perkCodeMessage(t, { code: '1', businessName: 'C', instructions: 'Ask for the barista.' })).toBe('Show staff at C this code to confirm: 1\n\nAsk for the barista.');
    expect(perkCodeMessage(t, { code: '1', businessName: 'C', instructions: '   ' })).toBe('Show staff at C this code to confirm: 1');
    expect(perkCodeMessage(t, { code: '1' })).not.toMatch(/account/i);
  });
  test('no code, no message', () => {
    expect(perkCodeMessage(t, { code: null, businessName: 'C' })).toBeNull();
  });
});

describe('every perk surface reads the one rule (source guards)', () => {
  const SURFACES = ['components/PerkRedemptionPanel.js', 'screens/CommunityDetailScreen.js', 'screens/BusinessProfileScreen.js'];
  test.each(SURFACES)('%s: state from perkRedemptionState, the code from PerkCodeBox, no dead fallback, no "Redeemed" alert on a claim', (r) => {
    const src = code(r);
    expect(src).toMatch(/perkRedemptionState\(/);
    expect(src).toMatch(/<PerkCodeBox /);
    expect(src).toMatch(/state === 'confirmed'/);
    expect(src).not.toMatch(/checkYourAccountForDetails|Check your account/);
    expect(src).not.toMatch(/ui\.(businessProfile|community)\.redeemed'\)|alreadyRedeemed|youveAlreadyRedeemedThis/);
    expect(src).not.toMatch(/getMyRedemptions\(/); // the claim-only id list cannot tell claimed from confirmed
  });
  test('the profile and community alerts after a claim are titled "Your code" and say the shared message', () => {
    for (const r of ['screens/CommunityDetailScreen.js', 'screens/BusinessProfileScreen.js']) {
      expect(code(r)).toMatch(/Alert\.alert\(t\('ui\.brandOffersUi\.yourCode'\), perkCodeMessage\(t, \{ code: confirmationCode,/);
    }
  });
  test('the Discover card says Redeemed only once confirmed', () => {
    expect(code('screens/DiscoverHubScreen.js')).toMatch(/redemptionState: perkRedemptionState\(myRedemptions\[o\.id\] \?\? null\)/);
    expect(code('utils/recommendationContext.js')).toMatch(/item\.redemptionState === 'confirmed'\) return \{ kind: 'status', label: 'Redeemed ✓'/);
  });
  test('the panel re-reads the viewer\'s row each time a perk opens (a confirmation since shows)', () => {
    expect(code('components/PerkRedemptionPanel.js')).toMatch(/getMyRedemptionFor\(offer\.id\)\.then\(\(row\) => \{ if \(!cancelled\) onRedemption\?\.\(offer\.id, row\); \}\)/);
  });
  test('static: the code box adds no animation', () => {
    expect(code('components/PerkCodeBox.js')).not.toMatch(/Animated|motion/);
  });
});

describe('confirmed visits only in the counts (owner, 2026-10-12)', () => {
  test('customer perk tier counts confirmed visits only', () => {
    expect(code('services/rewards.js')).toMatch(/\.select\('id', \{ count: 'exact', head: true \}\)\s*\.not\('confirmed_at', 'is', null\)/);
  });
  test('the dashboard stats migration filters both functions on confirmed_at, bucketed by redeemed_at like billing', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270305_confirmed_visit_counts.sql'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/function public\.get_business_dashboard_stats\(partner_id_param uuid\)/);
    expect(sql).toMatch(/function public\.get_business_growth\(partner_id_param uuid\)/);
    expect(sql.match(/confirmed_at is not null/g)).toHaveLength(3);
    expect(sql).not.toMatch(/confirmed_at >=/);
  });
});
