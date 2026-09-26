// Owner item 72: "reservation required" and friends -- one declared booking mode, and the CTA follows it automatically.
import fs from 'fs';
import path from 'path';
import { BOOKING_MODE_KEYS, bookingModeOf, bookingModeOption } from './bookingMode';
import { businessPrimaryAction } from '../utils/primaryAction';
import { businessEntity, usableNowTier, isConfirmedUsableNow, getOperatingStatus, getAvailabilityStatus, perkEntity, filterOpenNow, businessHoursLabel } from '../utils/operatingStatus';
import { businessActionForItem, businessActionRoute, intentResultBusinessRoute } from '../utils/businessAction';
import { applyCommitmentToCandidates } from './commitmentLevel';
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

describe('Open Now vs Available Now (the approved table)', () => {
  const posting = { startsAt: new Date(MON_10AM.getTime() - 3600000).toISOString(), endsAt: new Date(MON_10AM.getTime() + 3600000).toISOString(), remainingCapacity: 4 };
  test('walk-in inside hours: open; available only if supported (pulse)', () => {
    const e = businessEntity(biz({ booking_mode: 'walk_in' }));
    expect(getOperatingStatus(e, MON_10AM)).toBe('open');
    expect(getAvailabilityStatus(e, MON_10AM)).toBe('unknown');
    const pulsed = businessEntity(biz({ booking_mode: 'walk_in', availability_pulse: 'open', availability_pulse_updated_at: new Date(MON_10AM.getTime() - 60000).toISOString() }));
    expect(getAvailabilityStatus(pulsed, MON_10AM)).toBe('available');
  });
  test('Book/Request inside hours: open now = unknown, available = unknown (a pulse is not a booking)', () => {
    for (const mode of ['reservation_required', 'request_required']) {
      const pulsed = businessEntity(biz({ booking_mode: mode, availability_pulse: 'open', availability_pulse_updated_at: new Date(MON_10AM.getTime() - 60000).toISOString() }));
      expect(getOperatingStatus(pulsed, MON_10AM)).toBe('unknown');
      expect(getAvailabilityStatus(pulsed, MON_10AM)).toBe('unknown');
      expect(isConfirmedUsableNow(pulsed, MON_10AM)).toBe(false);
    }
  });
  test('Book/Request + live availability post: open now unknown, available now available', () => {
    const e = businessEntity(biz({ booking_mode: 'reservation_required' }), { posting });
    expect(getOperatingStatus(e, MON_10AM)).toBe('unknown');
    expect(getAvailabilityStatus(e, MON_10AM)).toBe('available');
    expect(usableNowTier(e, MON_10AM)).toBe('available');
  });
  test('closed: closed and unavailable, for every mode', () => {
    for (const mode of [null, 'walk_in', 'reservation_recommended', 'reservation_required', 'request_required']) {
      const e = businessEntity(biz({ booking_mode: mode }));
      expect(getOperatingStatus(e, MON_6PM)).toBe('closed');
      expect(getAvailabilityStatus(e, MON_6PM)).toBe('unavailable');
    }
  });
  test('missing hours: unknown', () => {
    expect(getOperatingStatus(businessEntity(biz({ booking_mode: 'walk_in', operating_hours: null })), MON_10AM)).toBe('unknown');
  });
  test('the Open now filter keeps a walk-in inside hours and drops a Book business inside hours', () => {
    const list = [biz({ id: 'w', booking_mode: 'walk_in' }), biz({ id: 'b', booking_mode: 'reservation_required' })];
    expect(filterOpenNow(list, (b) => businessEntity(b), MON_10AM).map((b) => b.id)).toEqual(['w']);
  });
  test('the public hours line never says "Open now" for a Book/Request business', () => {
    expect(businessHoursLabel(biz({ booking_mode: 'walk_in' }), MON_10AM)).toMatch(/^Open now/);
    const booked = businessHoursLabel(biz({ booking_mode: 'reservation_required' }), MON_10AM);
    expect(booked).not.toMatch(/Open now/);
    expect(booked).toMatch(/booking needed/);
  });
});

describe('perks stay independent of booking mode', () => {
  test('a perk at a Book business inside hours is still open (its own rules)', () => {
    const partner = biz({ booking_mode: 'reservation_required' });
    expect(getOperatingStatus(perkEntity({}, partner), MON_10AM)).toBe('open');
  });
  test('a perk result never carries a booking action', () => {
    expect(businessActionForItem({ type: 'perk', businessPartner: biz({ booking_mode: 'reservation_required' }) })).toBeNull();
  });
});

describe('commitment reads the declared mode', () => {
  test('walk-in = drop in, book/request first = reservation, recommended = the tag as before', () => {
    expect(commitmentOf({ bookingMode: 'walk_in', category: 'Fine Dining' })).toBe('drop_in');
    expect(commitmentOf({ bookingMode: 'reservation_required', category: 'Coffee' })).toBe('reservation');
    expect(commitmentOf({ bookingMode: 'request_required' })).toBe('reservation');
    expect(commitmentOf({ bookingMode: 'reservation_recommended', category: 'Coffee' })).toBe('drop_in');
  });
  test('"I don\'t want to commit" reorders but never removes; unknown mode is neutral', () => {
    const list = [
      { id: 'book', bookingMode: 'reservation_required', score: 5 },
      { id: 'none', score: 5 },
      { id: 'walk', bookingMode: 'walk_in', score: 5 },
    ];
    const out = applyCommitmentToCandidates(list, 'light');
    expect(out).toHaveLength(3);
    const byId = Object.fromEntries(out.map((c) => [c.id, c.score]));
    expect(byId.walk).toBeGreaterThan(byId.none);
    expect(byId.book).toBeLessThan(byId.none);
    expect(byId.none).toBe(5);
  });
  test('"I don\'t want to commit" sinks a book-first business and lifts a walk-in', () => {
    expect(commitmentFit({ bookingMode: 'reservation_required' }, 'light').delta).toBeLessThan(0);
    expect(commitmentFit({ bookingMode: 'walk_in' }, 'light').delta).toBeGreaterThan(0);
  });
});

describe('one action everywhere (profile, Discover, typed ask, Home, Surprise Me)', () => {
  const item = (mode, over = {}) => ({ type: 'business_policy_match', id: 'x', partnerId: 'b1', businessPartner: biz({ booking_mode: mode }), ...over });
  test.each([
    ['walk_in', 'Go now', 'url'],
    ['reservation_recommended', 'Reserve', 'navigate'],
    ['reservation_required', 'Book', 'navigate'],
    ['request_required', 'Request', 'navigate'],
  ])('%s: the profile and a typed-ask result give the same label and the same route', (mode, label, kind) => {
    const partner = biz({ booking_mode: mode });
    const profileAction = businessPrimaryAction(partner, { at: MON_10AM });
    const resultAction = businessActionForItem(item(mode), MON_10AM);
    expect(profileAction.label).toBe(label);
    expect(resultAction).toEqual(profileAction);
    const profileRoute = businessActionRoute(profileAction, { partner, partnerId: 'b1' });
    const resultRoute = intentResultBusinessRoute(item(mode), { at: MON_10AM });
    expect(profileRoute.kind).toBe(kind);
    expect(resultRoute.kind).toBe(kind);
    if (kind === 'url') expect(resultRoute.url).toBe(profileRoute.url);
    else {
      expect(resultRoute.screen).toBe('AskBusiness');
      expect(resultRoute.params.targetPartner).toEqual({ id: 'b1', name: 'Coastal Coffee' });
      expect(profileRoute.params.targetPartner).toEqual({ id: 'b1', name: 'Coastal Coffee' });
      expect(resultRoute.params.bookingMode).toBe(mode);
      expect(profileRoute.params.bookingMode).toBe(mode);
    }
  });
  test('Book on a result is never the generic request to many businesses', () => {
    const r = intentResultBusinessRoute(item('reservation_required'), { at: MON_10AM });
    expect(r.params.targetPartner).toBeTruthy();
  });
  test("a Book business's own live posting stays bound to that posting (it reaches only that business)", () => {
    const posted = item('reservation_required', {
      type: 'business_availability', matchedAvailability: { availabilityId: 'a1', partnerName: 'Coastal Coffee' },
      postingStartsAt: new Date(MON_10AM.getTime() - 3600000).toISOString(), postingEndsAt: new Date(MON_10AM.getTime() + 3600000).toISOString(),
    });
    const r = intentResultBusinessRoute(posted, { at: MON_10AM });
    expect(r.params.matchedAvailability.availabilityId).toBe('a1');
    expect(r.params.bookingMode).toBe('reservation_required');
  });
  test('no declared mode keeps the general request form (unchanged)', () => {
    const r = intentResultBusinessRoute(item(null), { typedText: 'coffee', at: MON_10AM });
    expect(r).toEqual(expect.objectContaining({ kind: 'navigate', screen: 'AskBusiness' }));
    expect(r.params.targetPartner).toBeUndefined();
    expect(r.params.prefillText).toBe('coffee');
  });
  test('legacy fallback and explicit override reach the result surfaces too', () => {
    const legacy = { ...item(null), businessPartner: biz({ attributes: ['reservation_required'] }) };
    expect(businessActionForItem(legacy, MON_10AM).label).toBe('Book');
    const overridden = { ...item(null), businessPartner: biz({ booking_mode: 'walk_in', attributes: ['reservation_required'] }) };
    expect(businessActionForItem(overridden, MON_10AM).label).toBe('Go now');
  });
});

describe('wiring guards', () => {
  test('Home, Discover and Surprise Me route business results only through the shared router', () => {
    const resolver = read('src/services/intentResolver.js');
    expect(resolver).toContain('intentResultBusinessRoute(item, { typedText, classifyResult })');
    const home = read('src/screens/HomeScreen.js');
    const discover = read('src/screens/DiscoverHubScreen.js');
    for (const src of [home, discover]) {
      expect(src).toContain('navigateToIntentResultItem(navigation, item');
      expect(src).toContain('businessActionForItem(item)');
      expect(src).not.toMatch(/item\.type === 'business_(availability|policy_match)'\)\s*\{[^}]*navigate\('AskBusiness'/);
    }
  });
  test('the profile uses the same route helper', () => {
    expect(read('src/screens/BusinessProfileScreen.js')).toContain('businessActionRoute(action,');
  });
  test('the resolver attaches the partner row to business results only, never perks', () => {
    const resolver = read('src/services/intentResolver.js');
    expect(resolver).toContain('if (!BUSINESS_RESULT_TYPES.includes(c.type) || !c.partnerId || !partnerInfo.has(c.partnerId)) return c;');
  });
  test('the setter refuses an invalid mode and a non-owner (migration text; verified live by scripts/live-verify/business-booking-mode.sql)', () => {
    const sql = read('supabase/migrations/20270212_business_booking_mode.sql');
    expect(sql).toContain("raise exception 'Invalid booking mode'");
    expect(sql).toContain("raise exception 'You do not manage this business'");
    expect(sql).toContain('revoke all on function public.set_business_booking_mode(uuid, text) from public, anon');
  });
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
