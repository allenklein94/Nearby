import fs from 'fs';
import path from 'path';
import { discountHeadlinePct, offerWhenDay, offerWhenLineText } from './offerPresentation';
import { assemblySteps } from './offerAssembly';
import { windowRangeLabel, availableWindowLabel } from './offerMedia';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 9, 10 + dayOffset, h, m);

describe('discount headline (structured discount_pct only)', () => {
  test('20 -> 20', () => expect(discountHeadlinePct({ discount_pct: 20 })).toBe(20));
  test('missing, zero, negative, over 100 or text = nothing', () => {
    for (const v of [null, undefined, 0, -5, 120, 'abc']) expect(discountHeadlinePct({ discount_pct: v })).toBeNull();
  });
  test('worded "20% OFF" in English, localized elsewhere', () => {
    const { translate } = require('../i18n/translate');
    expect(translate('en', 'ui.requestDetail.percentOff', { pct: 20 })).toBe('20% OFF');
    expect(translate('es', 'ui.requestDetail.percentOff', { pct: 20 })).toMatch(/20/);
  });
  test('never read from the description', () => {
    expect(discountHeadlinePct({ offer_description: '20% off tonight' })).toBeNull();
  });
});

describe('one "Tonight · 5–9 PM" line', () => {
  const offer = (validUntil, from = '17:00', until = '21:00') => ({ available_from: from, available_until: until, valid_until: validUntil.toISOString() });
  test('valid until 9 PM today, window 5–9 PM, seen at 2 PM = Today (5 PM is before the 6 PM tonight boundary)', () => {
    expect(offerWhenDay(offer(at(21)), at(14))).toBe('today');
  });
  test('a window starting at 6 PM or later reads Tonight', () => {
    expect(offerWhenDay(offer(at(22), '18:00', '22:00'), at(14))).toBe('tonight');
  });
  test('valid until tomorrow evening = Tomorrow', () => {
    expect(offerWhenDay(offer(at(21, 0, 1)), at(14))).toBe('tomorrow');
  });
  test('validity ending before the window ends keeps the separate lines', () => {
    expect(offerWhenDay(offer(at(19)), at(14))).toBeNull();
  });
  test('ending soon or expired keeps the countdown / expired line', () => {
    expect(offerWhenDay(offer(at(21)), at(20, 45))).toBeNull();
    expect(offerWhenDay(offer(at(21)), at(22))).toBeNull();
  });
  test('no window, no validity, or a later day = separate lines', () => {
    expect(offerWhenDay({ valid_until: at(21).toISOString() }, at(14))).toBeNull();
    expect(offerWhenDay({ available_from: '17:00', available_until: '21:00' }, at(14))).toBeNull();
    expect(offerWhenDay(offer(at(21, 0, 3)), at(14))).toBeNull();
  });
  test('English line reads "Today · 5–9 PM"', () => {
    expect(offerWhenLineText('today', '17:00', '21:00', 'en')).toBe('Today · 5–9 PM');
    expect(offerWhenLineText('tonight', '18:00', '22:00', 'en')).toBe('Tonight · 6–10 PM');
  });
  test('other languages get their own day word and clock', () => {
    expect(offerWhenLineText('tonight', '18:00', '22:00', 'es')).toMatch(/^Esta noche · /);
    expect(offerWhenLineText('today', '17:00', '21:00', 'de')).toMatch(/^Heute · 17/);
  });
  test('the old "Available" wording is unchanged', () => {
    expect(windowRangeLabel('17:00', '21:00')).toBe('5–9 PM');
    expect(availableWindowLabel('17:00', '21:00')).toBe('Available 5–9 PM');
  });
});

describe('layout', () => {
  test('a discount alone still gets its assembly step', () => {
    expect(assemblySteps({ status: 'offered', discount_pct: 20 })).toContain('price');
  });
  test('media comes first in the body, before the description, discount and price', () => {
    const src = read('components/OfferCustomerBody.js');
    const media = src.indexOf('<OfferMedia');
    expect(media).toBeGreaterThan(0);
    expect(media).toBeLessThan(src.indexOf('o.offer_description ?'));
    expect(src.indexOf('o.offer_description ?')).toBeLessThan(src.indexOf("percentOff"));
    expect(src.indexOf("percentOff")).toBeLessThan(src.indexOf('styles.offerPrice'));
  });
  test("the owner's Customer Preview carries the discount it will send", () => {
    expect(read('screens/BusinessDashboardScreen.js')).toMatch(/discount_pct: offerTypeInput === 'discount' \? parseDiscountPct\(offerDiscountInput\) : null,\n\s+available_from/);
  });
});
