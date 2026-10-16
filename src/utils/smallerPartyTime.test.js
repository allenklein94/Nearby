import { offerTimes, timePartySize, wholePartyView, needsTimePick, timeToBook } from './offerTimes';
import { replyTimeFit, fittingTime, FIT } from './replyFit';
import { draftSecondPartySize, draftPreviewOffer } from './offerDraftPreview';
import { bookedPartySize } from './acceptedBooking';
import { buildPlanSummary } from './planAddonReadiness';

// Item 119b (owner reopened item 119's partial-party lock, 2026-10-16): a reply's SECOND time may be for fewer people
// ("4 at 7 PM or 6 at 8:30 PM" for a party of 6, written here as whole party first). The first is always the whole party;
// group plans only ever see the whole-party time; accepting the smaller time books that many.
const NOW = new Date(2026, 9, 16, 12, 0);
const at = (d, h, mi = 0) => new Date(2026, 9, d, h, mi).toISOString();
const T830 = at(17, 20, 30);
const T7 = at(17, 19);
const smaller = { id: 'o1', status: 'offered', offer_type: 'alt_time', offer_description: 'x', proposed_time: T830, proposed_time_alt: T7, proposed_party_size_alt: 4 };
const request = { party_size: 6, date: '2026-10-17', time_window_start: '19:00' };

describe('timePartySize / wholePartyView', () => {
  test('only the second time can carry a smaller headcount; the first is the whole party', () => {
    expect(timePartySize(smaller, T830)).toBeNull();
    expect(timePartySize(smaller, T7)).toBe(4);
    expect(timePartySize({ ...smaller, proposed_party_size_alt: null }, T7)).toBeNull();
    expect(timePartySize({ ...smaller, proposed_party_size_alt: 0 }, T7)).toBeNull();
  });
  test('a group sees only the whole-party time; other replies are unchanged', () => {
    const view = wholePartyView(smaller);
    expect(offerTimes(view)).toEqual([T830]);
    expect(needsTimePick(view, NOW)).toBe(false);
    expect(timeToBook(view, null, NOW)).toBeNull(); // one time: the server books it, nothing to choose
    const both = { ...smaller, proposed_party_size_alt: null };
    expect(wholePartyView(both)).toBe(both);
    expect(wholePartyView(null)).toBeNull();
  });
  test('the person (not a group) still picks between the two times', () => {
    expect(needsTimePick(smaller, NOW)).toBe(true);
    expect(timeToBook(smaller, T7, NOW)).toBe(T7);
  });
});

describe('ranking (item 63): a smaller-party time never fits', () => {
  test('the stated 7 PM offered only for fewer people does not fit', () => {
    expect(replyTimeFit(request, smaller)).toBe(FIT.FAILS);
    expect(fittingTime(request, smaller)).toBeNull();
  });
  test('the same 7 PM for the whole party fits', () => {
    const whole = { ...smaller, proposed_party_size_alt: null };
    expect(replyTimeFit(request, whole)).toBe(FIT.FITS);
    expect(fittingTime(request, whole)).toBe(T7);
  });
});

describe('draftSecondPartySize (Send and the preview)', () => {
  const first = new Date(T830);
  const second = new Date(T7);
  test('a whole number from 1 to one fewer than the party, beside a real second time only', () => {
    expect(draftSecondPartySize('alt_time', first, second, 4, 6)).toBe(4);
    expect(draftSecondPartySize('alt_time', first, second, 1, 6)).toBe(1);
    expect(draftSecondPartySize('alt_time', first, second, 6, 6)).toBeNull();
    expect(draftSecondPartySize('alt_time', first, second, 0, 6)).toBeNull();
    expect(draftSecondPartySize('alt_time', first, second, 2.5, 6)).toBeNull();
    expect(draftSecondPartySize('alt_time', first, second, 1, 1)).toBeNull();
    expect(draftSecondPartySize('alt_time', first, second, 4, null)).toBeNull();
    expect(draftSecondPartySize('alt_time', first, null, 4, 6)).toBeNull();
    expect(draftSecondPartySize('standard', first, second, 4, 6)).toBeNull();
  });
  test('the preview carries what Send would send', () => {
    const draft = { type: 'alt_time', description: 'Dinner', proposedTime: first, proposedTimeAlt: second, partySizeAlt: 4, requestPartySize: 6 };
    expect(draftPreviewOffer(draft, NOW).proposed_party_size_alt).toBe(4);
    expect(draftPreviewOffer({ ...draft, proposedTimeAlt: null }, NOW).proposed_party_size_alt).toBeNull();
  });
});

describe('bookedPartySize: the headcount booked', () => {
  test('an accepted smaller-party time books that many; otherwise the request party', () => {
    expect(bookedPartySize(request, { status: 'accepted', proposed_party_size: 4 })).toBe(4);
    expect(bookedPartySize(request, { status: 'completed', proposed_party_size: 4 })).toBe(4);
    expect(bookedPartySize(request, { status: 'accepted', proposed_party_size: null })).toBe(6);
    expect(bookedPartySize(request, { status: 'offered', proposed_party_size: 4 })).toBe(6);
    expect(bookedPartySize(request, null)).toBe(6);
    expect(bookedPartySize({}, null)).toBeNull();
  });
  test('Your Plan shows the booked headcount', () => {
    const primary = { id: 'r1', status: 'fulfilled', category: 'Restaurants', party_size: 6, date: '2026-10-17' };
    const offer = { id: 'o1', status: 'accepted', proposed_time: T7, proposed_party_size: 4, brand_partners: { name: 'Bistro' }, business_reservations: [{ status: 'confirmed' }] };
    expect(buildPlanSummary({ primary, primaryOffers: [offer], now: NOW }).partySize).toBe(4);
    expect(buildPlanSummary({ primary, primaryOffers: [{ ...offer, proposed_party_size: null }], now: NOW }).partySize).toBe(6);
  });
});
