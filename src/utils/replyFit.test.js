import { FIT, replyTimeFit, replyBudgetFit, replyMeetsRequest, rankReplies } from './replyFit';
import fs from 'fs';
import path from 'path';

// Local wall-clock fixtures (never a UTC 'Z' string): the request's date/time are the customer's local day and clock.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).toISOString();
const REQ = { date: '2026-10-14', time_window_start: '19:00:00', budget_max: 15, party_size: 4 };
const est = { reputation: { total_opportunities: 8, completion_rate: 90 } };
const strong = { reputation: { total_opportunities: 20, completion_rate: 100 } };
const fresh = { reputation: { total_opportunities: 2, completion_rate: 100 } };

describe('replyTimeFit', () => {
  test('nothing stated -> not applicable', () => {
    expect(replyTimeFit({}, { offer_type: 'standard' })).toBeNull();
  });
  test('a plain reply from the business confirms "as requested" (owner decision A)', () => {
    expect(replyTimeFit(REQ, { offer_type: 'standard' })).toBe(FIT.FITS);
    expect(replyTimeFit(REQ, { offer_type: 'discount' })).toBe(FIT.FITS);
  });
  test('a window must contain the stated start (end exclusive)', () => {
    expect(replyTimeFit(REQ, { offer_type: 'standard', available_from: '17:00:00', available_until: '21:00:00' })).toBe(FIT.FITS);
    expect(replyTimeFit(REQ, { offer_type: 'standard', available_from: '19:00:00', available_until: '20:00:00' })).toBe(FIT.FITS);
    expect(replyTimeFit(REQ, { offer_type: 'standard', available_from: '17:00:00', available_until: '19:00:00' })).toBe(FIT.FAILS);
    expect(replyTimeFit(REQ, { offer_type: 'standard', available_from: '20:00:00', available_until: '22:00:00' })).toBe(FIT.FAILS);
  });
  test('a window on a date-only request is that day', () => {
    expect(replyTimeFit({ date: '2026-10-14' }, { offer_type: 'standard', available_from: '17:00:00', available_until: '19:00:00' })).toBe(FIT.FITS);
  });
  test('an alternate time meets the request only when it actually matches it', () => {
    expect(replyTimeFit(REQ, { offer_type: 'alt_time', proposed_time: at(2026, 10, 14, 20, 30) })).toBe(FIT.FAILS);
    expect(replyTimeFit(REQ, { offer_type: 'alt_time', proposed_time: at(2026, 10, 15, 19, 0) })).toBe(FIT.FAILS);
    expect(replyTimeFit(REQ, { offer_type: 'alt_time', proposed_time: at(2026, 10, 14, 19, 0) })).toBe(FIT.FITS);
    expect(replyTimeFit({ date: '2026-10-14' }, { offer_type: 'alt_time', proposed_time: at(2026, 10, 14, 12, 0) })).toBe(FIT.FITS);
    expect(replyTimeFit(REQ, { offer_type: 'alt_time', proposed_time: null })).toBe(FIT.UNKNOWN);
  });
  test('automatic replies from a posted availability or a package never checked the stated time: unknown', () => {
    expect(replyTimeFit(REQ, { offer_type: 'standard', availability_id: 'a1' })).toBe(FIT.UNKNOWN);
    expect(replyTimeFit(REQ, { offer_type: 'standard', package_id: 'p1' })).toBe(FIT.UNKNOWN);
    expect(replyTimeFit({}, { offer_type: 'standard', availability_id: 'a1' })).toBeNull();
  });
  test('standing-policy auto-accept and AI auto-respond replies have not verified the stated time: unknown (option 1)', () => {
    expect(replyTimeFit(REQ, { offer_type: 'standard', auto_reply: 'policy' })).toBe(FIT.UNKNOWN);
    expect(replyTimeFit(REQ, { offer_type: 'standard', auto_reply: 'ai', offer_price: 10, price_is_per_person: true })).toBe(FIT.UNKNOWN);
    expect(replyTimeFit({ date: '2026-10-14' }, { offer_type: 'standard', auto_reply: 'policy' })).toBe(FIT.UNKNOWN);
    // nothing stated: nothing to verify, so an automatic reply is treated like any other (decision C)
    expect(replyMeetsRequest({}, { offer_type: 'standard', auto_reply: 'ai' }).qualifies).toBe(true);
    // a business's own reply (auto_reply null) keeps decision A
    expect(replyTimeFit(REQ, { offer_type: 'standard', auto_reply: null })).toBe(FIT.FITS);
  });
});

describe('replyBudgetFit', () => {
  test('no budget given -> not applicable, price never matters', () => {
    expect(replyBudgetFit({ party_size: 4 }, { offer_price: 999 })).toBeNull();
  });
  test('per-person price against the per-person budget', () => {
    expect(replyBudgetFit(REQ, { offer_price: 15, price_is_per_person: true })).toBe(FIT.FITS);
    expect(replyBudgetFit(REQ, { offer_price: 15.01, price_is_per_person: true })).toBe(FIT.FAILS);
  });
  test('a total price against budget x party size, only with a known party size', () => {
    expect(replyBudgetFit(REQ, { offer_price: 60, price_is_per_person: false })).toBe(FIT.FITS);
    expect(replyBudgetFit(REQ, { offer_price: 61, price_is_per_person: false })).toBe(FIT.FAILS);
    expect(replyBudgetFit({ budget_max: 15 }, { offer_price: 12, price_is_per_person: false })).toBe(FIT.UNKNOWN);
  });
  test('no price = unknown, never a match', () => {
    expect(replyBudgetFit(REQ, { offer_price: null })).toBe(FIT.UNKNOWN);
  });
});

describe('replyMeetsRequest', () => {
  test('qualifies only when every stated constraint is verified; reasons are the constraints met, time first', () => {
    const r = replyMeetsRequest(REQ, { offer_type: 'standard', offer_price: 12, price_is_per_person: true });
    expect(r.qualifies).toBe(true);
    expect(r.reasons).toEqual([{ kind: 'time', date: '2026-10-14', startMin: 19 * 60 }, { kind: 'budget' }]);
  });
  test('one unknown fact = not qualifying, no reasons', () => {
    const r = replyMeetsRequest(REQ, { offer_type: 'standard', offer_price: null });
    expect(r.qualifies).toBe(false);
    expect(r.reasons).toEqual([]);
  });
  test('nothing stated: qualifies with no reasons (decision C)', () => {
    expect(replyMeetsRequest({}, { offer_type: 'alt_time', offer_price: 500 })).toEqual({ qualifies: true, time: null, budget: null, reasons: [] });
  });
});

describe('rankReplies', () => {
  const o = (id, partner, extra = {}) => ({ id, partner_id: partner, status: 'offered', offer_type: 'standard', offer_price: 10, price_is_per_person: true, ...extra });

  test('a qualifying reply outranks a stronger-record reply that does not qualify, and is the pick', () => {
    const offers = [o('late', 'P1', { offer_type: 'alt_time', proposed_time: at(2026, 10, 14, 21, 0) }), o('fits', 'P2')];
    const r = rankReplies(offers, REQ, { P1: strong, P2: est });
    expect(r.offers.map((x) => x.id)).toEqual(['fits', 'late']);
    expect(r.pickOfferId).toBe('fits');
    expect(r.pickReasons.map((x) => x.kind)).toEqual(['time', 'budget']);
  });
  test('no pick when the qualifying reply has no established record, though it still ranks first', () => {
    const offers = [o('late', 'P1', { offer_type: 'alt_time', proposed_time: at(2026, 10, 14, 21, 0) }), o('fits', 'P2')];
    const r = rankReplies(offers, REQ, { P1: strong, P2: fresh });
    expect(r.offers.map((x) => x.id)).toEqual(['fits', 'late']);
    expect(r.pickOfferId).toBeNull();
  });
  test('no pick when nothing qualifies (unknown price), whatever the records', () => {
    const offers = [o('a', 'P1', { offer_price: null }), o('b', 'P2', { availability_id: 'av' })];
    const r = rankReplies(offers, REQ, { P1: strong, P2: strong });
    expect(r.pickOfferId).toBeNull();
    expect(r.pickReasons).toEqual([]);
  });
  test('track record only breaks ties inside a tier; then arrival order; price is never a weight', () => {
    const offers = [o('cheapFresh', 'P1', { offer_price: 1 }), o('est', 'P2', { offer_price: 15 }), o('strong', 'P3', { offer_price: 14 }), o('fresh2', 'P4', { offer_price: 2 })];
    const r = rankReplies(offers, REQ, { P1: fresh, P2: est, P3: strong, P4: fresh });
    expect(r.offers.map((x) => x.id)).toEqual(['strong', 'est', 'cheapFresh', 'fresh2']);
    expect(r.pickOfferId).toBe('strong');
  });
  test('the lower tier keeps the same tie-breaker', () => {
    const offers = [o('q', 'P1'), o('nf1', 'P2', { offer_price: 99 }), o('nf2', 'P3', { offer_price: 99 })];
    const r = rankReplies(offers, REQ, { P2: fresh, P3: strong });
    expect(r.offers.map((x) => x.id)).toEqual(['q', 'nf2', 'nf1']);
  });
  test('nothing stated: today\'s behaviour (record decides the pick), no reasons line', () => {
    const offers = [o('a', 'P1'), o('b', 'P2')];
    const r = rankReplies(offers, {}, { P1: fresh, P2: est });
    expect(r.offers.map((x) => x.id)).toEqual(['b', 'a']);
    expect(r.pickOfferId).toBe('b');
    expect(r.pickReasons).toEqual([]);
  });
  test('a single open reply: no ordering change, no pick', () => {
    const offers = [o('a', 'P1'), { id: 'w', partner_id: 'P2', status: 'pending' }];
    expect(rankReplies(offers, REQ, { P1: strong })).toMatchObject({ offers, pickOfferId: null });
  });
  test('only open replies move; other rows keep their slots', () => {
    const offers = [o('nf', 'P1', { offer_price: 99 }), { id: 'w', partner_id: 'P9', status: 'pending' }, o('q', 'P2')];
    const r = rankReplies(offers, REQ, { P1: strong });
    expect(r.offers.map((x) => x.id)).toEqual(['q', 'w', 'nf']);
  });
});

describe('guards', () => {
  const src = fs.readFileSync(path.join(__dirname, 'replyFit.js'), 'utf8');
  test('the rule never reads payment, sponsorship or distance, and never weighs price', () => {
    expect(src).not.toMatch(/sponsor|payment|latitude|longitude|distance/i);
    expect(src).not.toMatch(/offer_price\s*[-+*]/);
  });
  test('the screen orders and picks only through rankReplies', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8');
    expect(screen).toMatch(/rankReplies\(offers, request, partnerStats\)/);
    expect(screen).not.toMatch(/reliabilityRank|hasEstablishedRecord/);
  });
  test('reasons wording is factual: no strength or "best" words in any language', () => {
    const requestDetail = require('../i18n/ui/requestDetail').default;
    const all = Object.values(requestDetail ?? {}).flatMap((l) => [l.pickFitsTime, l.pickWithinBudget]);
    expect(all.filter(Boolean)).toHaveLength(22);
    all.forEach((s) => expect(s).not.toMatch(/best|perfect|strong|mejor|beste|meilleur|melhor|лучш|最佳|最好/i));
  });
});
