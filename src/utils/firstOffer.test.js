// Owner item 51: a business's first-ever offer gets its own confirmation, decided by the server, words only.
import fs from 'fs';
import path from 'path';
import { replySentConfirmation, offerQueuedConfirmation } from './actionConfirmations';
import { submissionView } from './offerSubmission';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const bizHelp = require('../i18n/ui/bizHelp').default;

describe("item 51: the business's first offer", () => {
  const offer = { offer_type: 'discount', discount_pct: 20, offer_title: '20% off tonight' };

  test('the first offer says so; the body stays what happens next', () => {
    expect(replySentConfirmation(offer, { first: true })).toEqual(['Your first offer is on its way', 'The customer can accept it now.']);
  });
  test('a repeat offer (or an unknown answer) reads exactly as before', () => {
    expect(replySentConfirmation(offer, { first: false })).toEqual(['Offer sent', 'The customer can accept it now.']);
    expect(replySentConfirmation(offer)).toEqual(['Offer sent', 'The customer can accept it now.']);
    expect(replySentConfirmation(offer, { first: 'yes' })[0]).toBe('Offer sent'); // only a real true counts
  });
  test('named by the real kind: a plain reply or a suggested time is never called an offer (item 121)', () => {
    expect(replySentConfirmation({ offer_type: 'standard' }, { first: true })[0]).toBe('Your first reply is on its way');
    expect(replySentConfirmation({ offer_type: 'alt_time' }, { first: true })[0]).toBe('Your first reply is on its way');
    expect(replySentConfirmation({ offer_type: 'standard' }, { first: true }).join(' ')).not.toMatch(/offer/i);
  });
  test('the queued "saved" step never claims a first send: nothing has been sent yet', () => {
    expect(offerQueuedConfirmation().join(' ')).not.toMatch(/first/i);
  });
  test('the screened-send list marks only the sent submission the server says is first', () => {
    const p = { offerType: 'discount', discountPct: 20, offerTitle: '20% off tonight' };
    expect(submissionView({ status: 'published', payload: p, is_first_offer: true }).headline).toBe('Your first offer is on its way');
    expect(submissionView({ status: 'published', payload: p, is_first_offer: false }).headline).toBe('Offer sent');
    expect(submissionView({ status: 'published', payload: p }).headline).toBe('Offer sent');
    for (const status of ['reviewing', 'in_review', 'needs_changes', 'not_sent', 'unavailable']) {
      expect(submissionView({ status, payload: p, is_first_offer: true }).headline).not.toMatch(/first/i);
    }
  });
  test('both strings exist in all 11 languages, distinct from the plain titles', () => {
    expect(Object.keys(bizHelp)).toHaveLength(11);
    for (const [lang, t] of Object.entries(bizHelp)) {
      expect([lang, typeof t.confirm.firstOfferTitle]).toEqual([lang, 'string']);
      expect([lang, typeof t.confirm.firstReplyTitle]).toEqual([lang, 'string']);
      expect(t.confirm.firstOfferTitle).not.toBe(t.confirm.offerTitle);
      expect(t.confirm.firstReplyTitle).not.toBe(t.confirm.firstOfferTitle);
    }
  });
  test('decided only by the server: the dashboard passes its answer, nothing stored on the device', () => {
    const dash = read('src/screens/BusinessDashboardScreen.js');
    expect(dash).toContain('replySentConfirmation(sent, { first: result.firstOffer === true })');
    expect(dash).not.toMatch(/first_?offer['"`]?\s*[,)]\s*.*AsyncStorage|AsyncStorage[^\n]*first_?offer/i);
    const edge = read('supabase/functions/screen-business-content/index.ts');
    expect(edge).toMatch(/from\('partner_first_offers'\)[\s\S]{0,200}firstOffer = !!writeResult\?\.offerId && first\?\.offer_id === writeResult\.offerId/);
    const mig = read('supabase/migrations/20270299_partner_first_offer.sql');
    expect(mig).toMatch(/on conflict \(partner_id\) do nothing/);
    expect(mig).toMatch(/revoke all on public\.partner_first_offers from public, anon, authenticated/);
  });
  test('words only: no motion, haptic, sound or confetti joins the confirmation', () => {
    const src = read('src/utils/actionConfirmations.js');
    expect(src).not.toMatch(/import .*(motion|haptic|Animated|Sound)/);
  });
  test("the customer's first-reply moment is untouched (LOCKED)", () => {
    const copy = read('src/utils/offerCopy.js');
    expect(copy).toMatch(/export function isFirstEverReply\(offerId, state\)/);
    expect(copy).toMatch(/export function heardLine\(isFirstEver\)/);
    expect(copy).not.toMatch(/partner_first_offers|firstOffer/);
  });
});
