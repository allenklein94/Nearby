import {
  isRevisedOffer, revisableTerms, canReviseOffer, revisionDraftFrom, revisionProblem, revisionParams, revisedOfferPreview,
} from './offerRevision';

const NOW = new Date(2026, 9, 16, 15, 0);
const at = (h, m = 0) => new Date(2026, 9, 16, h, m).toISOString();
const offer = (over = {}) => ({
  id: 'o1', status: 'offered', revision: 0, offer_price: 60, price_is_per_person: true, discount_pct: null,
  proposed_time: at(19), proposed_time_alt: null, valid_until: null, availability_id: null, package_id: null, auto_reply: null,
  business_requests: { status: 'open', expires_at: at(23) },
  ...over,
});

describe('canReviseOffer (item 118)', () => {
  it('allows one revision of an open, hand-written reply', () => {
    expect(canReviseOffer(offer(), undefined, NOW)).toBe(true);
  });
  it('refuses a second revision, a closed offer, an automatic reply and a closed or expired request', () => {
    expect(canReviseOffer(offer({ revision: 1 }), undefined, NOW)).toBe(false);
    for (const status of ['pending', 'accepted', 'declined', 'expired', 'withdrawn', 'completed']) {
      expect(canReviseOffer(offer({ status }), undefined, NOW)).toBe(false);
    }
    expect(canReviseOffer(offer({ availability_id: 'a' }), undefined, NOW)).toBe(false);
    expect(canReviseOffer(offer({ package_id: 'p' }), undefined, NOW)).toBe(false);
    expect(canReviseOffer(offer({ auto_reply: 'policy' }), undefined, NOW)).toBe(false);
    expect(canReviseOffer(offer({ business_requests: { status: 'fulfilled' } }), undefined, NOW)).toBe(false);
    expect(canReviseOffer(offer({ business_requests: { status: 'open', expires_at: at(14) } }), undefined, NOW)).toBe(false);
    expect(canReviseOffer(offer({ valid_until: at(14) }), undefined, NOW)).toBe(false);
  });
  it('needs a price, discount or time to change', () => {
    expect(canReviseOffer(offer({ offer_price: null, proposed_time: null }), undefined, NOW)).toBe(false);
    expect(canReviseOffer(offer({ offer_price: null, proposed_time: null, discount_pct: 10 }), undefined, NOW)).toBe(true);
  });
});

describe('revisionProblem: price only down, time either way (item 118)', () => {
  const o = offer();
  const d = (over) => ({ ...revisionDraftFrom(o), ...over });
  it('a lower price or a later/earlier time can be sent', () => {
    expect(revisionProblem(o, d({ price: 50 }), { now: NOW })).toBeNull();
    expect(revisionProblem(o, d({ time: at(20, 30) }), { now: NOW })).toBeNull();
    expect(revisionProblem(o, d({ time: at(17) }), { now: NOW })).toBeNull();
  });
  it('a higher price is refused; an emptied price is refused', () => {
    expect(revisionProblem(o, d({ price: 61 }), { now: NOW })).toBe('priceHigher');
    expect(revisionProblem(o, d({ price: '' }), { now: NOW })).toBe('priceMissing');
  });
  it('nothing changed is refused', () => {
    expect(revisionProblem(o, d({}), { now: NOW })).toBe('unchanged');
    expect(revisionProblem(o, d({ price: '60' }), { now: NOW })).toBe('unchanged');
  });
  it('a passed time is refused', () => {
    expect(revisionProblem(o, d({ time: at(14) }), { now: NOW })).toBe('timePassed');
  });
  it('discount only bigger, within the cap', () => {
    const od = offer({ offer_price: null, discount_pct: 10, offer_type: 'discount' });
    const dd = (over) => ({ ...revisionDraftFrom(od), ...over });
    expect(revisionProblem(od, dd({ discount: 15 }), { now: NOW, discountCap: 20 })).toBeNull();
    expect(revisionProblem(od, dd({ discount: 5 }), { now: NOW })).toBe('discountLower');
    expect(revisionProblem(od, dd({ discount: 25 }), { now: NOW, discountCap: 20 })).toBe('discountOverCap');
  });
  it('two times: both still ahead, never the same', () => {
    const o2 = offer({ proposed_time_alt: at(20, 30) });
    const d2 = (over) => ({ ...revisionDraftFrom(o2), ...over });
    expect(revisionProblem(o2, d2({ timeAlt: at(21) }), { now: NOW })).toBeNull();
    expect(revisionProblem(o2, d2({ timeAlt: at(19) }), { now: NOW })).toBe('sameTimes');
    expect(revisionProblem(o2, d2({ timeAlt: null }), { now: NOW })).toBe('timePassed');
  });
});

describe('revisionParams / preview', () => {
  it('sends only the terms the reply had; never adds a price, discount or time', () => {
    const o = offer({ offer_price: null, proposed_time: null, discount_pct: 10 });
    const p = revisionParams(o, { price: 40, discount: 15, time: at(20), timeAlt: at(21) });
    expect(p).toEqual({ offer_id_param: 'o1', offer_price_param: null, discount_pct_param: 15, proposed_time_param: null, proposed_time_alt_param: null });
  });
  it('the preview carries the new terms and revision 1, and no previous price anywhere', () => {
    const o = offer();
    const pv = revisedOfferPreview(o, { ...revisionDraftFrom(o), price: 50 });
    expect(pv.offer_price).toBe(50);
    expect(pv.revision).toBe(1);
    expect(isRevisedOffer(pv)).toBe(true);
    expect(JSON.stringify(pv)).not.toMatch(/"previous|"was_|"old_/);
    expect(Object.values(pv)).not.toContain(60);
  });
  it('revisableTerms counts the times', () => {
    expect(revisableTerms(offer()).times).toBe(1);
    expect(revisableTerms(offer({ proposed_time_alt: at(21) })).times).toBe(2);
    expect(revisableTerms(offer({ proposed_time: null })).times).toBe(0);
  });
});
