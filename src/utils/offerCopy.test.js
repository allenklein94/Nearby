const fs = require('fs');
const path = require('path');
const { businessReplyTitle, businessReplyKind, businessReplyStatus, acceptedReplyTitle, offerRevealHeader } = require('./offerCopy');

describe('offer copy is a personal response, not an ad', () => {
  it('says "made you an offer" only for a real offer', () => {
    expect(businessReplyTitle('Coastal Coffee', { status: 'offered', offer_title: 'Latte + pastry' })).toBe('Coastal Coffee made you an offer');
    expect(businessReplyTitle('Coastal Coffee', { status: 'accepted', offer_price: 12 })).toBe('Coastal Coffee made you an offer');
    expect(businessReplyTitle('Coastal Coffee', { status: 'declined' })).toBe('Coastal Coffee responded to your request');
    expect(businessReplyTitle('Coastal Coffee', { status: 'withdrawn' })).toBe('Coastal Coffee responded to your request');
    expect(businessReplyTitle(null, { status: 'offered', discount_pct: 10 })).toBe('A local business made you an offer');
  });
  it('the reveal header uses the same wording', () => {
    expect(offerRevealHeader('Coastal Coffee')).toBe('Coastal Coffee made you an offer');
  });
  it('no consumer offer surface uses ad language', () => {
    for (const f of ['screens/BusinessRequestDetailScreen.js', 'screens/ActivityScreen.js', 'components/OfferReveal.js', 'components/OfferMedia.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(src).not.toMatch(/sponsored|promoted content|advertisement/i);
    }
  });
  it('the offer push says "made you an offer"', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270153_offer_push_personal_copy.sql'), 'utf8');
    expect(sql).toMatch(/made you an offer/);
    expect(sql).not.toMatch(/sent you "/);
  });
});

// Owner item 121 (2026-09-27): three reply kinds, plain availability is never called an offer.
describe('business reply kinds', () => {
  const availability = { status: 'offered', offer_type: 'standard', offer_title: null, offer_price: null, discount_pct: null, included_items: [] };
  const alternative = { status: 'offered', offer_type: 'alt_time', proposed_time: '2026-10-01T20:00:00Z' };
  const offers = [
    { status: 'offered', offer_type: 'standard', offer_title: '2 coffees + 2 pastries' },
    { status: 'offered', offer_type: 'standard', offer_price: 12 },
    { status: 'offered', offer_type: 'standard', offer_price: 0 },
    { status: 'offered', offer_type: 'discount', discount_pct: 20 },
    { status: 'offered', offer_type: 'standard', included_items: ['Coffee', 'Pastry'] },
    { status: 'offered', offer_type: 'perk' },
    { status: 'offered', offer_type: 'upgrade' },
  ];
  it('plain availability: "can take you", never an offer', () => {
    expect(businessReplyKind(availability)).toBe('availability');
    expect(businessReplyKind({ status: 'offered' })).toBe('availability');
    expect(businessReplyTitle('Coastal Coffee', availability)).toBe('Coastal Coffee can take you');
    expect(businessReplyStatus(availability)).toBe('Can take you');
    expect(acceptedReplyTitle('Coastal Coffee', { ...availability, status: 'accepted' })).toBe('You chose Coastal Coffee');
    for (const s of [businessReplyTitle('Coastal Coffee', availability), businessReplyStatus(availability), acceptedReplyTitle('Coastal Coffee', availability)]) {
      expect(s).not.toMatch(/offer/i);
    }
  });
  it('Offer Alternative: "suggested another time"', () => {
    expect(businessReplyKind(alternative)).toBe('alternative');
    expect(businessReplyKind({ ...alternative, offer_price: 10 })).toBe('alternative');
    expect(businessReplyTitle('Coastal Coffee', alternative)).toBe('Coastal Coffee suggested another time');
    expect(businessReplyStatus(alternative)).toBe('Suggested another time');
    expect(acceptedReplyTitle('Coastal Coffee', alternative)).toBe("You took Coastal Coffee's suggested time");
  });
  it('a real offer (title, price, discount, items, or an offer type): "made you an offer"', () => {
    for (const o of offers) {
      expect(businessReplyKind(o)).toBe('offer');
      expect(businessReplyTitle('Coastal Coffee', o)).toBe('Coastal Coffee made you an offer');
      expect(businessReplyStatus(o)).toBe('Made you an offer');
      expect(acceptedReplyTitle('Coastal Coffee', o)).toBe("You accepted Coastal Coffee's offer");
    }
  });
  it('a decline / withdrawal of any kind is only "responded to your request"', () => {
    for (const o of [availability, alternative, offers[0]]) {
      expect(businessReplyTitle('Coastal Coffee', { ...o, status: 'declined' })).toBe('Coastal Coffee responded to your request');
      expect(businessReplyTitle('Coastal Coffee', { ...o, status: 'withdrawn' })).toBe('Coastal Coffee responded to your request');
    }
  });
  it('consumer surfaces word replies through this helper and Activity loads the fields it reads', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const activity = read('screens/ActivityScreen.js');
    expect(activity).toMatch(/businessReplyTitle\(/);
    expect(activity).toMatch(/acceptedReplyTitle\(/);
    expect(activity).not.toMatch(/You accepted \$\{partnerName\}'s offer/);
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/businessReplyStatus\(o\)/);
    expect(read('utils/primaryAction.js')).toMatch(/businessReplyKind\(offer\)/);
    const loader = read('services/businessFulfillment.js');
    const sel = loader.match(/id, request_id, offer_type, offer_price[^']*/)[0];
    for (const c of ['offer_title', 'discount_pct', 'included_items']) expect(sel).toContain(c);
  });
});
