// Item 12 (owner, 2026-10-10): after accepting, the offer card itself morphs in place into its booked state and stays.
const fs = require('fs');
const path = require('path');
import { acceptedBookingState, ACCEPTED_TITLE_KEY, acceptedWhenLine, acceptedPartySize } from '../utils/acceptedBooking';
import { SEQUENCES, settleMs, isWithinBudget } from './motionBudget';
import requestDetail from '../i18n/ui/requestDetail';

const strip = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const lookup = (lang, key) => key.replace('ui.requestDetail.', '').split('.').reduce((o, k) => o?.[k], requestDetail[lang]);

describe('"You\'re booked" only when a reservation is really confirmed', () => {
  const offer = (status) => ({ status: 'accepted', business_reservations: status ? [{ status }] : [] });
  test('state comes from the stored reservation', () => {
    expect(acceptedBookingState(offer('confirmed'))).toBe('booked');
    expect(acceptedBookingState(offer('requested'))).toBe('confirming');
    expect(acceptedBookingState(offer('failed'))).toBe('not_through');
    expect(acceptedBookingState(offer(null))).toBe('accepted'); // group-plan accept writes no reservation
    expect(acceptedBookingState({ status: 'accepted' })).toBe('accepted');
    expect(acceptedBookingState(null)).toBe('accepted');
  });
  test('only the confirmed state uses the locked booking wording; every heading exists in all 11 languages', () => {
    expect(ACCEPTED_TITLE_KEY.booked).toBe('ui.requestDetail.youreBooked');
    expect(Object.entries(ACCEPTED_TITLE_KEY).filter(([, k]) => k === 'ui.requestDetail.youreBooked').map(([s]) => s)).toEqual(['booked']);
    for (const lang of Object.keys(requestDetail)) {
      for (const key of Object.values(ACCEPTED_TITLE_KEY)) expect(typeof lookup(lang, key)).toBe('string');
    }
    expect(requestDetail.en.youreBooked).toBe("You're booked");
    expect(requestDetail.en.booking.accepted).not.toMatch(/booked/i);
    expect(requestDetail.en.booking.confirming).not.toMatch(/booked/i);
  });
});

describe('facts: only what is real', () => {
  test('when = the accepted alternative time, else the request day + time, else nothing', () => {
    expect(acceptedWhenLine({ proposedTimeLabel: 'Sat 8 PM', dateLabel: 'Fri, Oct 9', timeLabel: '6:30 PM' })).toBe('Sat 8 PM');
    expect(acceptedWhenLine({ dateLabel: 'Tonight', timeLabel: '6:30 PM' })).toBe('Tonight · 6:30 PM');
    expect(acceptedWhenLine({ dateLabel: 'Fri, Oct 9' })).toBe('Fri, Oct 9');
    expect(acceptedWhenLine({ proposedTimeLabel: '  ' })).toBeNull();
    expect(acceptedWhenLine()).toBeNull();
  });
  test('party size only when the customer gave a real one', () => {
    expect(acceptedPartySize({ party_size: 4 })).toBe(4);
    expect(acceptedPartySize({ party_size: null })).toBeNull();
    expect(acceptedPartySize({ party_size: 0 })).toBeNull();
    expect(acceptedPartySize({ party_size: 2.5 })).toBeNull();
    expect(acceptedPartySize(null)).toBeNull();
  });
});

test('motion: ✓ then morph, inside the special tier and the owner\'s targets', () => {
  const s = SEQUENCES.offerAccepted;
  expect(s.checkMs).toBeGreaterThanOrEqual(180); expect(s.checkMs).toBeLessThanOrEqual(250);
  expect(s.morphMs).toBeGreaterThanOrEqual(250); expect(s.morphMs).toBeLessThanOrEqual(350);
  expect(isWithinBudget(settleMs('offerAccepted'), s.tier)).toBe(true);
});

describe('component guards', () => {
  const src = strip(read('motion/OfferAcceptedMorph.js'));
  test('a transaction, not a party: success colour, no spring/loop/confetti, tokens only', () => {
    expect(src).toMatch(/colors\.success/);
    expect(src).not.toMatch(/Animated\.spring|Animated\.loop|confetti|🎉|particle/i);
    expect(src).not.toMatch(/duration:\s*\d/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
  test('plays once, decided at mount; Reduce Motion = settled; ✓ and vibration only for a real booking the person tapped', () => {
    expect(src).toMatch(/useRef\(play && !reduceMotion\)\.current/);
    expect(src).toMatch(/if \(play && haptic && booked\) playHaptic\(HAPTIC_MOMENTS\.success\)/);
    expect(src).toMatch(/\{booked \? \(/);
  });
});

describe('screen wiring (BusinessRequestDetail)', () => {
  const src = strip(read('screens/BusinessRequestDetailScreen.js'));
  test('no separate card above the offers; the accepted offer card morphs in place', () => {
    expect(src).not.toMatch(/BookedCelebration/);
    expect(src).toMatch(/o\.status === 'accepted' \? \(\(\) => \{/);
    expect(src).toMatch(/<OfferAcceptedMorph[\s\S]*?play=\{justAcceptedOfferId === o\.id\}/);
  });
  test('submitting: one accept in flight; the morph only follows a successful server accept and a reload', () => {
    expect(src).toMatch(/if \(acceptingRef\.current\) return;/);
    const handler = src.slice(src.indexOf('async function handleAccept'), src.indexOf('async function collectPayment'));
    expect(handler.indexOf('await acceptBusinessOffer(offerId)')).toBeLessThan(handler.indexOf('setJustAcceptedOfferId(offerId)'));
    expect(handler.indexOf('setJustAcceptedOfferId(offerId)')).toBeLessThan(handler.indexOf('await load()'));
    expect(handler).toMatch(/finally \{\s*acceptingRef\.current = false;/);
  });
  test('error / unavailable: the card is re-read so it shows the real state, and the button comes back', () => {
    const handler = src.slice(src.indexOf('async function handleAccept'), src.indexOf('async function collectPayment'));
    const catchBlock = handler.slice(handler.indexOf('catch (e)'));
    expect(catchBlock).toMatch(/load\(\)\.catch/);
    expect(catchBlock).toMatch(/presentRecoverableError/);
    expect(handler).toMatch(/setActingOfferId\(null\)/);
  });
  test('redeem: the business\'s own instructions, no Redeem button; Mark as completed unchanged', () => {
    expect(src).toMatch(/visibleRedemption\(o\) \? \(\s*<View style=\{styles\.redeemCallout\}>/);
    expect(src).not.toMatch(/t\('ui\.requestDetail\.redeem'\)/);
    expect(src).toMatch(/onPress=\{\(\) => handleComplete\(o\.id\)\}/);
    expect(src).toMatch(/t\('ui\.requestDetail\.markAsCompleted'\)/);
  });
});
