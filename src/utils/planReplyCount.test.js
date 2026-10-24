// Owner item 160 (2026-10-18): one reply tally for every plan row that counts a request's business replies. "N offers —
// choose one" only when every open reply really is an offer; otherwise "N businesses responded" (item 121: a plain or
// automatic "we can take you" is never called an offer). A reply stops counting AT its valid_until or the request's
// deadline (isOfferOpen), whatever the hourly sweep has stored yet. Home's Your Plans, Plans' request rows, GatheringDetail
// (incl. the host line), Matches and DateProposal all read the same tally and line.
const fs = require('fs');
const path = require('path');
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { tallyBusinessReplies, requestReplyStatuses, placeStatusLine, formatPlaceStatusLabel } = require('./planCompletion');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const NOW = new Date('2026-10-18T18:00:00.000Z');
const OPEN_REQ = { status: 'open', expires_at: '2026-10-19T18:00:00.000Z' };
const later = '2026-10-18T20:00:00.000Z';

const offer = (name, extra = {}) => ({ status: 'offered', offer_type: 'discount', discount_pct: 10, valid_until: later, brand_partners: { name }, business_requests: OPEN_REQ, ...extra });
const plain = (name, extra = {}) => ({ status: 'offered', offer_type: 'standard', valid_until: later, brand_partners: { name }, business_requests: OPEN_REQ, ...extra });
const pending = (name) => ({ status: 'pending', brand_partners: { name }, business_requests: OPEN_REQ });

describe('the tally', () => {
  test('every open reply is an offer -> "N offers — choose one"', () => {
    const t = tallyBusinessReplies([offer('A'), offer('B', { offer_type: 'standard', discount_pct: null, offer_price: 12 }), pending('C')], { now: NOW });
    expect(t).toMatchObject({ offeredCount: 2, pendingCount: 1, allOffers: true, offeredNames: ['A', 'B'] });
    expect(placeStatusLine({ state: 'pending', ...t })).toBe('2 offers — choose one');
  });

  test('a mix of offers and plain replies -> "N businesses responded"', () => {
    const t = tallyBusinessReplies([offer('A'), plain('B')], { now: NOW });
    expect(t).toMatchObject({ offeredCount: 2, allOffers: false });
    expect(placeStatusLine({ state: 'pending', ...t })).toBe('2 businesses responded');
  });

  test('automatic replies (policy / AI / availability: nothing concrete) are not offers', () => {
    const t = tallyBusinessReplies([plain('Auto', { auto_reply: 'policy' }), plain('AI', { auto_reply: 'ai' })], { now: NOW });
    expect(t.allOffers).toBe(false);
    expect(placeStatusLine({ state: 'pending', ...t })).toBe('2 businesses responded');
    expect(placeStatusLine({ state: 'pending', ...tallyBusinessReplies([plain('Auto', { auto_reply: 'policy' })], { now: NOW }) })).toBe('1 business responded');
  });

  test('a suggested other time is not an offer either', () => {
    const t = tallyBusinessReplies([offer('A'), plain('B', { offer_type: 'alt_time' })], { now: NOW });
    expect(t.allOffers).toBe(false);
  });

  test('declines, withdrawals and expired rows never count', () => {
    const t = tallyBusinessReplies([offer('A'), { ...offer('B'), status: 'declined' }, { ...offer('C'), status: 'withdrawn' }, { ...offer('D'), status: 'expired' }], { now: NOW });
    expect(t).toMatchObject({ offeredCount: 1, pendingCount: 0, allOffers: true, offeredNames: ['A'] });
  });

  test('an offer stops counting AT its exact valid_until, before the hourly sweep stores it', () => {
    const end = '2026-10-18T19:00:00.000Z';
    const rows = [offer('A', { valid_until: end }), offer('B')];
    expect(tallyBusinessReplies(rows, { now: new Date(Date.parse(end) - 1) }).offeredCount).toBe(2);
    expect(tallyBusinessReplies(rows, { now: new Date(end) }).offeredCount).toBe(1);
    expect(tallyBusinessReplies(rows, { now: new Date(Date.parse(end) + 1) }).offeredCount).toBe(1);
  });

  test('the request\'s own deadline closes every reply and every wait AT that instant', () => {
    const req = { status: 'open', expires_at: '2026-10-18T19:00:00.000Z' };
    const rows = [offer('A', { business_requests: req }), { ...pending('B'), business_requests: req }];
    expect(tallyBusinessReplies(rows, { now: new Date('2026-10-18T18:59:59.999Z') })).toMatchObject({ offeredCount: 1, pendingCount: 1 });
    expect(tallyBusinessReplies(rows, { now: new Date('2026-10-18T19:00:00.000Z') })).toMatchObject({ offeredCount: 0, pendingCount: 0 });
  });

  test('rows without an embedded request use the one passed in; none at all = nothing counted (unknown)', () => {
    const bare = { status: 'offered', offer_type: 'discount', discount_pct: 5, valid_until: later };
    expect(tallyBusinessReplies([bare], { request: OPEN_REQ, now: NOW }).offeredCount).toBe(1);
    expect(tallyBusinessReplies([bare], { now: NOW }).offeredCount).toBe(0);
  });

  test('unknown kind defaults to the truthful wording, never "offers"', () => {
    expect(formatPlaceStatusLabel({ place: 'pending', offeredCount: 3 })).toBe('3 businesses responded');
    expect(formatPlaceStatusLabel({ place: 'pending', pendingCount: 2 })).toBe('Asked 2 businesses — waiting to hear back');
    expect(formatPlaceStatusLabel({ place: 'pending' })).toBe('Waiting for business offer');
  });
});

describe('per request (getRequestReplyStatuses\' grouping)', () => {
  test('accepted = booked at the business; otherwise the tally; no rows = waiting', () => {
    const rows = [
      { request_id: 'r1', ...offer('A') }, { request_id: 'r1', ...plain('B') },
      { request_id: 'r2', ...offer('C'), status: 'accepted' }, { request_id: 'r2', ...offer('D') },
    ];
    const s = requestReplyStatuses(['r1', 'r2', 'r3'], rows, NOW);
    expect(placeStatusLine(s.r1)).toBe('2 businesses responded');
    expect(placeStatusLine(s.r2)).toBe('C');
    expect(placeStatusLine(s.r3)).toBe('Waiting for business offer');
    expect(placeStatusLine(undefined)).toBeUndefined();
  });
});

describe('one source on every surface', () => {
  test('Home and Plans show the same line from the same tally', () => {
    expect(read('screens/HomeScreen.js')).toMatch(/return placeStatusLine\(planPlaceStatus\[gatheringId\]\)/);
    const plans = read('screens/PlansScreen.js');
    // idea "397": an expired request (on Past) says "Request expired" instead; every other row reads the same tally
    expect(plans).toMatch(/venueName=\{item\.place\.closed \? t\('ui\.actions\.requestExpired'\) : placeStatusLine\(requestReplyStatus\[plan\.resulting_business_request_id\]\)\}/);
    expect(plans).toMatch(/getRequestReplyStatuses\(ids\)/);
    // read when the rows load (each focus), never a subscription or a ticking count
    expect(plans).not.toMatch(/requestReplyStatus[\s\S]{0,200}(subscribe|channel\(|setInterval)/);
  });

  test('every counter uses the one tally; nobody counts status === \'offered\' by hand', () => {
    const svc = read('services/businessFulfillment.js');
    expect(svc).toMatch(/return requestReplyStatuses\(ids, offers\)/);
    expect(svc).toMatch(/const byRequest = await getRequestReplyStatuses\(/); // getGatheringPlaceStatuses = the request-keyed core
    expect(read('services/dateProposals.js')).toMatch(/tallyBusinessReplies\(rows, \{ request: requestById\[requestId\] \}\)/);
    for (const f of ['services/businessFulfillment.js', 'services/dateProposals.js']) {
      expect(read(f)).not.toMatch(/offeredCount \+= 1/);
    }
  });

  test('gathering and match rows pass the offer-or-not fact through', () => {
    expect(read('screens/MatchesScreen.js')).toMatch(/allOffers: activePlan\?\.allOffers \?\? false/);
    expect(read('screens/GatheringDetailScreen.js')).toMatch(/formatPlaceStatusLabel\(\{ place: 'pending', \.\.\.placeOfferCounts \}\)/);
    expect(read('screens/DateProposalScreen.js')).toMatch(/formatPlaceStatusLabel\(\{ place: 'pending', \.\.\.placeOfferCounts \}\)/);
  });

  test('no new strings: "N businesses responded" is the request screen\'s existing timeline string', () => {
    expect(read('utils/planCompletion.js')).toMatch(/tr\('ui\.requestDetail\.timeline\.businessesResponded'/);
  });
});
