// Owner item 72: "reservation required" and friends -- one declared booking mode, and the CTA follows it automatically.
import fs from 'fs';
import path from 'path';
import { BOOKING_MODE_KEYS, bookingModeOf, bookingModeOption } from './bookingMode';
import { businessPrimaryAction } from '../utils/primaryAction';
import { businessEntity, usableNowTier, isConfirmedUsableNow } from '../utils/operatingStatus';
import { commitmentOf, commitmentFit } from './commitmentLevel';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LA = 'America/Los_Angeles';
const HOURS = {
  timezone: LA,
  week: { sun: 'closed', mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']], sat: 'closed' },
};
const MON_10AM = new Date('2026-09-28T17:00:00Z'); // open
const MON_6PM = new Date('2026-09-29T01:00:00Z'); // closed
const biz = (over = {}) => ({ id: 'b1', name: 'Coastal Coffee', latitude: 34, longitude: -118, address: '1 Main St', operating_hours: HOURS, ...over });

describe('booking mode vocabulary', () => {
  test('matches the DB CHECK exactly', () => {
    const sql = read('supabase/migrations/20270212_business_booking_mode.sql');
    for (const k of BOOKING_MODE_KEYS) expect(sql).toContain(`'${k}'`);
    expect(BOOKING_MODE_KEYS).toEqual(['walk_in', 'reservation_recommended', 'reservation_required', 'request_required']);
  });
  test('declared mode wins; legacy attribute is only a fallback; nothing is guessed', () => {
    expect(bookingModeOf({ booking_mode: 'walk_in', attributes: ['reservation_required'] })).toBe('walk_in');
    expect(bookingModeOf({ attributes: ['quiet', 'reservation_required'] })).toBe('reservation_required');
    expect(bookingModeOf({ subcategory: 'Fine Dining', attributes: [] })).toBeNull();
    expect(bookingModeOf({ booking_mode: 'drive_thru' })).toBeNull();
    expect(bookingModeOf(null)).toBeNull();
  });
  test('customer line per mode', () => {
    expect(bookingModeOption('reservation_required').customerLine).toBe('Reservation required');
    expect(bookingModeOption('nope')).toBeNull();
  });
});

describe('the CTA follows the mode (businessPrimaryAction)', () => {
  test('no declared mode = null (the surface keeps its own default)', () => {
    expect(businessPrimaryAction(biz(), { at: MON_10AM })).toBeNull();
  });
  test('walk-in: Go now only while confirmed open; unknown hours = directions; closed = nothing', () => {
    expect(businessPrimaryAction(biz({ booking_mode: 'walk_in' }), { at: MON_10AM })).toEqual({ kind: 'go_now', label: 'Go now' });
    expect(businessPrimaryAction(biz({ booking_mode: 'walk_in', operating_hours: null }), { at: MON_10AM })).toEqual({ kind: 'directions', label: 'Get Directions' });
    expect(businessPrimaryAction(biz({ booking_mode: 'walk_in' }), { at: MON_6PM })).toBeNull();
  });
  test('walk-in with no place to go never offers Go now', () => {
    expect(businessPrimaryAction(biz({ booking_mode: 'walk_in', latitude: null, longitude: null, address: null }), { at: MON_10AM })).toBeNull();
  });
  test('walk-in: a fresh "full" pulse means no Go now (the default CTA stays)', () => {
    const full = biz({ booking_mode: 'walk_in', availability_pulse: 'full', availability_pulse_updated_at: new Date(MON_10AM.getTime() - 60000).toISOString() });
    expect(businessPrimaryAction(full, { at: MON_10AM })).toBeNull();
  });
  test('reservation recommended: Reserve, with Go now as a secondary only while open', () => {
    const open = businessPrimaryAction(biz({ booking_mode: 'reservation_recommended' }), { at: MON_10AM });
    expect(open).toEqual({ kind: 'reserve', label: 'Reserve', secondary: { kind: 'go_now', label: 'Go now' } });
    expect(businessPrimaryAction(biz({ booking_mode: 'reservation_recommended' }), { at: MON_6PM }).secondary).toBeNull();
  });
  test('reservation required: Book; request required: Request (open or closed)', () => {
    for (const at of [MON_10AM, MON_6PM]) {
      expect(businessPrimaryAction(biz({ booking_mode: 'reservation_required' }), { at })).toEqual({ kind: 'book', label: 'Book' });
      expect(businessPrimaryAction(biz({ booking_mode: 'request_required' }), { at })).toEqual({ kind: 'request', label: 'Request' });
    }
  });
  test('legacy attribute alone gives Book', () => {
    expect(businessPrimaryAction(biz({ attributes: ['reservation_required'] }), { at: MON_10AM }).label).toBe('Book');
  });
});

describe('Open now (item 71) respects the mode', () => {
  test('open hours do not make a book-first or request-first business usable now', () => {
    for (const mode of ['reservation_required', 'request_required']) {
      const e = businessEntity(biz({ booking_mode: mode }));
      expect(usableNowTier(e, MON_10AM)).toBe('unknown');
      expect(isConfirmedUsableNow(e, MON_10AM)).toBe(false);
    }
  });
  test('a live posting with room still makes it available', () => {
    const posting = { startsAt: new Date(MON_10AM.getTime() - 3600000).toISOString(), endsAt: new Date(MON_10AM.getTime() + 3600000).toISOString(), remainingCapacity: 4 };
    expect(usableNowTier(businessEntity(biz({ booking_mode: 'reservation_required' }), { posting }), MON_10AM)).toBe('available');
  });
  test('walk-in and recommended stay open while open; closed stays closed', () => {
    expect(usableNowTier(businessEntity(biz({ booking_mode: 'walk_in' })), MON_10AM)).toBe('open');
    expect(usableNowTier(businessEntity(biz({ booking_mode: 'reservation_recommended' })), MON_10AM)).toBe('open');
    expect(usableNowTier(businessEntity(biz({ booking_mode: 'reservation_required' })), MON_6PM)).toBe('closed');
  });
});

describe('commitment reads the declared mode', () => {
  test('walk-in = drop in, book/request first = reservation, recommended = the tag as before', () => {
    expect(commitmentOf({ bookingMode: 'walk_in', category: 'Fine Dining' })).toBe('drop_in');
    expect(commitmentOf({ bookingMode: 'reservation_required', category: 'Coffee' })).toBe('reservation');
    expect(commitmentOf({ bookingMode: 'request_required' })).toBe('reservation');
    expect(commitmentOf({ bookingMode: 'reservation_recommended', category: 'Coffee' })).toBe('drop_in');
  });
  test('"I don\'t want to commit" sinks a book-first business and lifts a walk-in', () => {
    expect(commitmentFit({ bookingMode: 'reservation_required' }, 'light').delta).toBeLessThan(0);
    expect(commitmentFit({ bookingMode: 'walk_in' }, 'light').delta).toBeGreaterThan(0);
  });
});

describe('wiring guards', () => {
  test('the business profile takes its CTA from the shared helper, never its own mode switch', () => {
    const src = read('src/screens/BusinessProfileScreen.js');
    expect(src).toContain('businessPrimaryAction(partner)');
    expect(src).not.toMatch(/booking_mode\s*===/);
  });
  test('booking mode never reaches a business-facing opportunity payload', () => {
    const src = read('src/services/businessFulfillment.js');
    expect(src).not.toContain('booking_mode');
  });
});
