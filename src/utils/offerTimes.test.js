import { offerTimes, hasTwoTimes, choosableTimes, needsTimePick, timeToBook, canBookWith, groupTimeConfirmations } from './offerTimes';
import { FIT, replyTimeFit, fittingTime, replyMeetsRequest } from './replyFit';
import { draftPreviewOffer, draftSecondTime } from './offerDraftPreview';
import { presentOffer } from './offerPresentationEngine';
import { buildAlternativeText } from './quickOfferResponse';

// Item 119: one business reply may offer two times for the same full party; the customer picks one.
const NOW = new Date(2026, 9, 16, 12, 0);
const at = (d, h, mi = 0) => new Date(2026, 9, d, h, mi).toISOString();
const T7 = at(17, 19);
const T830 = at(17, 20, 30);
const two = { id: 'o1', status: 'offered', offer_type: 'alt_time', offer_description: 'x', proposed_time: T7, proposed_time_alt: T830 };
const one = { id: 'o2', status: 'offered', offer_type: 'alt_time', offer_description: 'x', proposed_time: T7, proposed_time_alt: null };

describe('offerTimes', () => {
  test('one, two or no times, in the business order; a repeated time is one time', () => {
    expect(offerTimes(two)).toEqual([T7, T830]);
    expect(offerTimes(one)).toEqual([T7]);
    expect(offerTimes({ proposed_time: null, proposed_time_alt: T830 })).toEqual([]);
    expect(offerTimes({ proposed_time: T7, proposed_time_alt: T7 })).toEqual([T7]);
    expect(hasTwoTimes(two)).toBe(true);
    expect(hasTwoTimes(one)).toBe(false);
  });
  test('a two-time reply waits for a pick; the pick must be one of its times', () => {
    expect(needsTimePick(two, NOW)).toBe(true);
    expect(timeToBook(two, null, NOW)).toBeNull();
    expect(canBookWith(two, null, NOW)).toBe(false);
    expect(timeToBook(two, at(17, 21), NOW)).toBeNull();
    expect(timeToBook(two, T830, NOW)).toBe(T830);
    expect(timeToBook(two, new Date(T830).toISOString(), NOW)).toBe(T830);
    expect(canBookWith(two, T7, NOW)).toBe(true);
  });
  test('a one-time reply sends no choice (the server books its time) and never waits', () => {
    expect(needsTimePick(one, NOW)).toBe(false);
    expect(timeToBook(one, null, NOW)).toBeNull();
    expect(canBookWith(one, null, NOW)).toBe(true);
  });
  test('when one of two times has passed, only the other is bookable (no pick needed)', () => {
    const later = new Date(2026, 9, 17, 19, 30);
    expect(choosableTimes(two, later)).toEqual([T830]);
    expect(needsTimePick(two, later)).toBe(false);
    expect(timeToBook(two, null, later)).toBe(T830);
    expect(timeToBook(two, T7, later)).toBe(T830);
  });
  test('group confirmations count per time on a two-time reply, all together on a one-time reply', () => {
    const rows = [
      { offer_id: 'o1', user_id: 'a', chosen_time: T7 },
      { offer_id: 'o1', user_id: 'b', chosen_time: T830 },
      { offer_id: 'o1', user_id: 'c', chosen_time: T7 },
      { offer_id: 'o2', user_id: 'a', chosen_time: null },
    ];
    expect(groupTimeConfirmations(two, rows, 'b')).toEqual({ total: 3, byTime: { [T7]: 2, [T830]: 1 }, mine: T830 });
    expect(groupTimeConfirmations(two, rows, 'z').mine).toBeNull();
    expect(groupTimeConfirmations(one, rows, 'a')).toEqual({ total: 1, byTime: {}, mine: true });
  });
});

describe('item 63 on a two-time reply', () => {
  const REQ = { date: '2026-10-17', time_window_start: '19:00:00' };
  test('it fits when either time is the stated time, and "Fits" belongs to that time only', () => {
    expect(replyTimeFit(REQ, two)).toBe(FIT.FITS);
    expect(fittingTime(REQ, two)).toBe(T7);
    const flipped = { ...two, proposed_time: T830, proposed_time_alt: T7 };
    expect(fittingTime(REQ, flipped)).toBe(T7);
    expect(replyMeetsRequest(REQ, flipped).qualifies).toBe(true);
  });
  test('neither time stated -> fails; nothing stated -> no fit and no "Fits"', () => {
    const neither = { ...two, proposed_time: at(17, 18), proposed_time_alt: T830 };
    expect(replyTimeFit(REQ, neither)).toBe(FIT.FAILS);
    expect(fittingTime(REQ, neither)).toBeNull();
    expect(fittingTime({}, two)).toBeNull();
    expect(fittingTime(REQ, one)).toBeNull(); // a one-time reply keeps "Fits" on the pick line, as before
  });
});

describe('the owner\'s form and preview send the same second time', () => {
  const first = new Date(T7);
  const second = new Date(T830);
  test('only on an alternative-time reply, only beside a first time, never the same time', () => {
    expect(draftSecondTime('alt_time', first, second)).toBe(T830);
    expect(draftSecondTime('standard', first, second)).toBeNull();
    expect(draftSecondTime('alt_time', null, second)).toBeNull();
    expect(draftSecondTime('alt_time', first, new Date(T7))).toBeNull();
    expect(draftSecondTime('alt_time', first, null)).toBeNull();
  });
  test('the live preview shows both times', () => {
    const p = draftPreviewOffer({ type: 'alt_time', description: 'We can do either', proposedTime: first, proposedTimeAlt: second });
    expect([p.proposed_time, p.proposed_time_alt]).toEqual([T7, T830]);
    expect(presentOffer(p, { context: { viewer: 'owner_preview', now: NOW } })).toMatchObject({ times: [T7, T830], pickTime: false });
  });
});

describe('presentOffer', () => {
  test('an open two-time reply asks the customer to pick; once booked the card has no times to pick', () => {
    expect(presentOffer(two, { context: { now: NOW } })).toMatchObject({ times: [T7, T830], pickTime: true });
    expect(presentOffer(one, { context: { now: NOW } })).toMatchObject({ times: [T7], pickTime: false });
    const booked = { ...two, status: 'accepted', proposed_time: T830, proposed_time_alt: null, business_reservations: [{ status: 'confirmed' }] };
    expect(presentOffer(booked, { context: { now: NOW } })).toMatchObject({ times: [], pickTime: false });
  });
});

test('the quick alternative line says "one of these times" only with a second time', () => {
  expect(buildAlternativeText('')).toBe("We can't do the requested time, but we can do this time instead.");
  expect(buildAlternativeText('', { twoTimes: true })).toBe("We can't do the requested time, but we can do one of these times instead.");
});
