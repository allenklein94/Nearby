// 20270430 (owner decisions 2026-11-21): the business is authoritative for a visit. These guard the ONE client rule
// (utils/visitConfirmation.js) and every client reader that used to treat status 'completed' as a confirmed visit.
import { offerVisitState, isVisitConfirmed, canMarkDone, canConfirmVisit, canReportNoShow, awaitsBusinessAnswer } from './visitConfirmation';
import { offerStage, offerProgress, progressKey, offersToAnimate, visitConfirmationsToAnimate, businessCardStatus } from './offerProgress';
import { isPipelineWon, isCompletedThisMonth } from './businessPipeline';
import { offerCard } from './offerPresentationEngine';

const now = new Date(2026, 10, 21, 12, 0);
const yesterday = '2026-11-20';
const tomorrow = '2026-11-22';
const req = (date) => ({ business_requests: { date } });
const accepted = (extra = {}) => ({ id: 'o1', request_id: 'r1', status: 'accepted', ...req(yesterday), ...extra });
const marked = (extra = {}) => accepted({ status: 'completed', completed_at: '2026-11-21T10:00:00Z', customer_done_at: '2026-11-21T10:00:00Z', ...extra });
const confirmed = (extra = {}) => accepted({ status: 'completed', completed_at: '2026-11-21T10:00:00Z', visit_confirmed_at: '2026-11-21T10:00:00Z', ...extra });
const legacy = () => accepted({ status: 'completed', completed_at: '2026-11-21T10:00:00Z' }); // before 20270430: nobody recorded

describe('offerVisitState: two separate facts, completed is never a confirmation by itself', () => {
  test('states', () => {
    expect(offerVisitState(accepted())).toBe(null);
    expect(offerVisitState(marked())).toBe('marked_done');
    expect(offerVisitState(confirmed())).toBe('confirmed');
    expect(offerVisitState(confirmed({ customer_done_at: '2026-11-21T09:00:00Z' }))).toBe('confirmed');
    expect(offerVisitState(legacy())).toBe('marked_done');
    expect(offerVisitState(null)).toBe(null);
  });
  test('only the business confirmation counts', () => {
    expect([accepted(), marked(), legacy()].some(isVisitConfirmed)).toBe(false);
    expect(isVisitConfirmed(confirmed())).toBe(true);
  });
});

describe('customer: one completion button at most', () => {
  test('Mark as done from the visit day on, on a still-open booking only', () => {
    expect(canMarkDone(accepted(), now)).toBe(true);
    expect(canMarkDone(accepted(req(tomorrow)), now)).toBe(false);
    expect(canMarkDone(marked(), now)).toBe(false);
    expect(canMarkDone(confirmed(), now)).toBe(false);
    expect(canMarkDone(legacy(), now)).toBe(false);
    expect(canMarkDone(accepted({ status: 'offered' }), now)).toBe(false);
  });
});

describe('business: Confirm visit / Didn\'t show up never contradict', () => {
  test('Confirm visit on a booking or a customer-marked one, from its day on, not after a no-show or confirmation', () => {
    expect(canConfirmVisit(accepted(), { now })).toBe(true);
    expect(canConfirmVisit(marked(), { now })).toBe(true);
    expect(canConfirmVisit(legacy(), { now })).toBe(true);
    expect(canConfirmVisit(accepted(req(tomorrow)), { now })).toBe(false);
    expect(canConfirmVisit(confirmed(), { now })).toBe(false);
    expect(canConfirmVisit(accepted(), { now, noShowIds: new Set(['o1']) })).toBe(false);
    for (const status of ['offered', 'cancelled', 'expired', 'declined']) expect(canConfirmVisit(accepted({ status }), { now })).toBe(false);
  });
  test('Didn\'t show up stays after the customer\'s own mark, never after a confirmation', () => {
    expect(canReportNoShow(accepted())).toBe(true);
    expect(canReportNoShow(marked())).toBe(true);
    expect(canReportNoShow(confirmed())).toBe(false);
    expect(canReportNoShow(accepted(), new Set(['o1']))).toBe(false);
  });
  test('Bookings keeps a customer-marked booking until the business answers', () => {
    expect(awaitsBusinessAnswer(marked())).toBe(true);
    expect(isPipelineWon(marked())).toBe(true);
    expect(isPipelineWon(confirmed())).toBe(false);
    expect(isPipelineWon(accepted(), new Set(['o1']))).toBe(false);
  });
});

describe('business figures count confirmations only', () => {
  test('pipeline Completed this month = visit_confirmed_at, never a customer mark or a legacy completion', () => {
    expect(isCompletedThisMonth(confirmed({ visit_confirmed_at: '2026-11-03T15:00:00' }), now)).toBe(true);
    expect(isCompletedThisMonth(confirmed({ visit_confirmed_at: '2026-10-30T15:00:00' }), now)).toBe(false);
    expect(isCompletedThisMonth(marked(), now)).toBe(false);
    expect(isCompletedThisMonth(legacy(), now)).toBe(false);
  });
  test('Offer sent -> Accepted -> Redeemed: a customer mark stays at Accepted', () => {
    expect(offerStage(marked())).toBe('accepted');
    expect(offerStage(legacy())).toBe('accepted');
    expect(offerStage(confirmed())).toBe('redeemed');
    expect(offerProgress(marked(), now)).toEqual({ current: 1 });
    expect(offerProgress(confirmed(), now)).toEqual({ current: 2 });
    expect(progressKey(marked())).toBe('o1:accepted');
    expect(progressKey(confirmed())).toBe('o1:redeemed');
    expect(businessCardStatus(marked(), now)).toBe('accepted');
    expect(businessCardStatus(legacy(), now)).toBe('accepted');
    expect(businessCardStatus(confirmed(), now)).toBe('completed');
  });
  test('the Redeemed glow plays only for a business confirmation seen live; a customer mark never replays Accepted', () => {
    const previous = new Map([['o1', 'accepted']]);
    expect(offersToAnimate([marked()], { previous, live: true })).toHaveLength(0);
    expect(offersToAnimate([confirmed()], { previous, live: true })).toHaveLength(1);
    expect(visitConfirmationsToAnimate([marked()], { previous, live: true })).toHaveLength(0);
    expect(visitConfirmationsToAnimate([confirmed()], { previous, live: true })).toHaveLength(1);
    expect(offersToAnimate([confirmed()], { previous: new Map([['o1', 'redeemed']]), live: true })).toHaveLength(0);
  });
});

describe('customer card', () => {
  test('"visited" (Visit confirmed) only from the business; a personal mark stays booked', () => {
    expect(offerCard(confirmed(), now)).toBe('visited');
    expect(offerCard(marked(), now)).toBe('booked');
    expect(offerCard(legacy(), now)).toBe('booked');
  });
});
