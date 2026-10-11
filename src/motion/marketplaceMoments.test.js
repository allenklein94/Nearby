import fs from 'fs';
import path from 'path';
import { MARKETPLACE_MOMENTS } from '../constants/motionLanguage';
import { SEQUENCES, settleMs, MOTION_BUDGET } from './motionBudget';
import { offersToAnimate, visitConfirmationsToAnimate, progressKey } from '../utils/offerProgress';
import { acceptedBookingState } from '../utils/acceptedBooking';

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const screen = src('screens/BusinessRequestDetailScreen.js');

describe('the six marketplace moments, in order', () => {
  it('names each moment once, with a real component and a budgeted sequence', () => {
    expect(MARKETPLACE_MOMENTS.map((m) => m.key)).toEqual([
      'request_sent', 'business_response', 'offer_reveal', 'offer_acceptance', 'business_progress', 'customer_redemption',
    ]);
    for (const m of MARKETPLACE_MOMENTS) {
      expect(fs.existsSync(path.join(__dirname, '..', m.component))).toBe(true);
      const s = SEQUENCES[m.sequence];
      expect(s).toBeDefined();
      const b = MOTION_BUDGET[s.tier];
      const ms = settleMs(m.sequence);
      expect(ms).toBeGreaterThanOrEqual(b.min);
      expect(ms).toBeLessThanOrEqual(b.max);
    }
  });
  it('the two new moments: Reduce Motion respected, no haptic of their own, no confetti/bounce', () => {
    for (const f of ['motion/RequestPulse.js', 'motion/VisitConfirmed.js']) {
      const s = src(f);
      expect(s).toMatch(/useReduceMotion/);
      expect(s).not.toMatch(/playHaptic|expo-haptics|spring|confetti|Animated\.loop/);
    }
  });
});

describe('moment 1: request sent pulse', () => {
  it('plays only for a real dispatch that reached a business (not a duplicate, not nobody reached)', () => {
    expect(screen).toMatch(/<RequestPulse play=\{!isDuplicate && notifiedCount > 0\}/);
  });
  it('never delays the confirmation: the line is a child rendered at once, rings are untouchable', () => {
    const s = src('motion/RequestPulse.js');
    expect(s).toMatch(/pointerEvents="none"/);
    expect(s).toMatch(/\{children\}/);
    expect(screen).toMatch(/<RequestPulse[\s\S]{0,600}justSentLine/);
  });
  it('fits under 500 ms', () => {
    expect(settleMs('requestPulse')).toBeLessThan(500);
  });
});

describe('moment 6: Visit confirmed', () => {
  const o = (status) => ({ id: 'o1', request_id: 'r1', status, business_reservations: [{ status: 'confirmed' }] });

  it('plays only for accepted -> completed seen live', () => {
    const previous = new Map([['o1', 'accepted']]);
    expect(visitConfirmationsToAnimate([o('completed')], { previous, live: true })).toHaveLength(1);
    expect(visitConfirmationsToAnimate([o('completed')], { previous, live: false })).toEqual([]); // revisit / focus reload
    expect(visitConfirmationsToAnimate([o('completed')], { previous: new Map(), live: true })).toEqual([]); // first read = baseline
    expect(visitConfirmationsToAnimate([o('accepted')], { previous: new Map([['o1', 'offered']]), live: true })).toEqual([]); // acceptance is not a visit
  });
  it('duplicate realtime events or notifications never replay it', () => {
    const shown = new Set([progressKey(o('completed'))]);
    expect(visitConfirmationsToAnimate([o('completed')], { previous: new Map([['o1', 'accepted']]), live: true, shown })).toEqual([]);
    expect(visitConfirmationsToAnimate([o('completed')], { previous: new Map([['o1', 'completed']]), live: true })).toEqual([]);
    // a push tap is not a customer trigger here
    expect(offersToAnimate([o('completed')], { focusRequestId: 'r1' })).toHaveLength(1);
    expect(visitConfirmationsToAnimate([o('completed')], { focusRequestId: 'r1' })).toEqual([]);
  });
  it('keeps "You\'re booked" only for a confirmed reservation; a completed visit keeps the booked card', () => {
    expect(acceptedBookingState(o('completed'))).toBe('booked');
    expect(acceptedBookingState({ status: 'completed', business_reservations: [] })).toBe('accepted');
    expect(screen).toMatch(/\{shown\.confirmation \? \(\(\) =>/);
    expect(screen).toMatch(/confirmation\.visitConfirmed \? \(\s*<VisitConfirmed/);
  });
  it('wording is a fact, never an action', () => {
    const strings = JSON.parse(src('../scripts/i18n/strings/requestDetail.json'));
    expect(strings.en.visitConfirmed).toBe('Visit confirmed');
    for (const lang of Object.keys(strings)) expect(strings[lang].visitConfirmed).toBeTruthy();
  });
  it('live: scoped to this request, only triggers a re-read, removed on blur', () => {
    expect(screen).toMatch(/filter: `request_id=eq\.\$\{requestId\}`/);
    expect(screen).toMatch(/liveReloadRef\.current = true; load\(\);/);
    expect(screen).toMatch(/supabase\.removeChannel\(channel\)/);
    expect(screen).not.toMatch(/visit_confirmed[\s\S]{0,400}payload\.new/);
  });
});
