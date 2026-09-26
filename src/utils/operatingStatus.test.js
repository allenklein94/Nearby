// Owner item 71: "Open now" -- one resolver, open / available / unknown kept apart, no invented hours.
import fs from 'fs';
import path from 'path';
import {
  hoursStatus, getOperatingStatus, getAvailabilityStatus, usableNowTier, isConfirmedUsableNow, filterOpenNow, openNowLift,
  operatingHoursProblem, openNowAskFromText, businessEntity, placeEntity, gatheringEntity, perkEntity, candidateEntity,
  weekHoursLines, PLACE_OPEN_NOW_FRESH_MS,
} from './operatingStatus';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LA = 'America/Los_Angeles';
const week = (over = {}) => ({
  sun: 'closed', mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']],
  thu: [['09:00', '17:00']], fri: [['09:00', '17:00']], sat: [['10:00', '14:00']], ...over,
});
const hours = (over = {}, extra = {}) => ({ timezone: LA, week: week(over), ...extra });
// Monday 2026-09-28 10:00 in Los Angeles (17:00 UTC); Sunday 23:30 LA; Monday 18:00 LA.
const MON_10AM = new Date('2026-09-28T17:00:00Z');
const SUN_1130PM = new Date('2026-09-28T06:30:00Z');
const MON_6PM = new Date('2026-09-29T01:00:00Z');
const MON_1AM = new Date('2026-09-28T08:00:00Z'); // Monday 01:00 LA

describe('owner-declared hours', () => {
  test('1. open during normal hours', () => {
    expect(hoursStatus(hours(), MON_10AM)).toEqual({ status: 'open', label: 'Open now · until 5 PM' });
  });
  test('2. closed outside hours', () => {
    expect(hoursStatus(hours(), MON_6PM).status).toBe('closed');
    expect(hoursStatus(hours(), SUN_1130PM).status).toBe('closed'); // Sunday is closed all day
  });
  test('3. overnight hours cross midnight, including into the next day', () => {
    const late = hours({ sun: [['18:00', '02:00']] });
    expect(hoursStatus(late, SUN_1130PM).status).toBe('open');
    expect(hoursStatus(late, MON_1AM)).toEqual({ status: 'open', label: 'Open now · until 2 AM' });
    expect(hoursStatus(late, new Date('2026-09-28T10:00:00Z')).status).toBe('closed'); // Monday 03:00
  });
  test('4. split hours (multiple intervals in one day)', () => {
    const split = hours({ mon: [['09:00', '14:00'], ['17:00', '22:00']] });
    expect(hoursStatus(split, MON_10AM).status).toBe('open');
    expect(hoursStatus(split, new Date('2026-09-28T22:30:00Z')).status).toBe('closed'); // 15:30 gap
    expect(hoursStatus(split, MON_6PM)).toEqual({ status: 'open', label: 'Open now · until 10 PM' });
  });
  test('5. 24 hours, and 6. closed all day', () => {
    expect(hoursStatus(hours({ sun: 'all_day' }), SUN_1130PM)).toEqual({ status: 'open', label: 'Open 24 hours' });
    expect(hoursStatus(hours({ mon: 'closed' }), MON_10AM).status).toBe('closed');
  });
  test('7. evaluated in the BUSINESS timezone, not the device clock', () => {
    // 17:00 UTC is Monday 10 AM in LA but Tuesday 2 AM in Tokyo.
    expect(hoursStatus(hours(), MON_10AM).status).toBe('open');
    expect(hoursStatus({ ...hours(), timezone: 'Asia/Tokyo' }, MON_10AM).status).toBe('closed');
    expect(hoursStatus({ ...hours(), timezone: 'Not/AZone' }, MON_10AM).status).toBe('unknown');
  });
  test('holiday / special hours override the weekly day, and temporary closure closes', () => {
    const xmas = new Date('2026-12-25T18:00:00Z'); // Friday 10 AM LA
    expect(hoursStatus(hours(), xmas).status).toBe('open');
    expect(hoursStatus(hours({}, { special: [{ date: '2026-12-25', hours: 'closed' }] }), xmas).status).toBe('closed');
    expect(hoursStatus(hours({ mon: 'closed' }, { special: [{ date: '2026-09-28', hours: [['08:00', '12:00']] }] }), MON_10AM).status).toBe('open');
    expect(hoursStatus(hours({}, { temporarily_closed: true }), MON_10AM)).toEqual({ status: 'closed', label: 'Temporarily closed' });
  });
  test('8. missing hours = unknown, never closed', () => {
    expect(hoursStatus(null, MON_10AM).status).toBe('unknown');
    expect(getOperatingStatus(businessEntity({}), MON_10AM)).toBe('unknown');
  });
});

describe('validation never corrects the owner silently', () => {
  test('rejects overlap, overnight spill, zero length, bad time, missing day, bad zone', () => {
    expect(operatingHoursProblem(hours())).toBeNull();
    expect(operatingHoursProblem(hours({ mon: [['09:00', '14:00'], ['13:00', '15:00']] }))).toMatch(/overlap/);
    expect(operatingHoursProblem(hours({ sun: [['18:00', '10:00']] }))).toMatch(/run into the next day/);
    expect(operatingHoursProblem(hours({ mon: [['09:00', '09:00']] }))).toMatch(/same time/);
    expect(operatingHoursProblem(hours({ mon: [['25:00', '10:00']] }))).toMatch(/opening and a closing/);
    expect(operatingHoursProblem({ timezone: LA, week: { ...week(), sat: undefined } })).toMatch(/Saturday/);
    expect(operatingHoursProblem({ ...hours(), timezone: 'Mars/Base' })).toMatch(/time zone/);
    expect(operatingHoursProblem(hours({ sun: [['18:00', '02:00']] }))).toBeNull();
  });
  test('the SQL validator states the same rules (kept in step with the client)', () => {
    const sql = read('supabase/migrations/20270211_business_operating_hours.sql');
    for (const msg of ['time ranges overlap', 'run into the next day', 'use 24 hours instead', 'Pick a valid time zone', 'at most 4 time ranges', 'At most 60 special days']) {
      expect(sql).toContain(msg);
    }
  });
});

describe('availability is separate from open', () => {
  const at = MON_10AM;
  test('9. a live availability posting makes a business usable (even with no hours)', () => {
    const posting = { startsAt: '2026-09-28T16:00:00Z', endsAt: '2026-09-28T19:00:00Z', remainingCapacity: 4 };
    const e = businessEntity({}, { posting });
    expect(getOperatingStatus(e, at)).toBe('unknown');
    expect(getAvailabilityStatus(e, at)).toBe('available');
    expect(isConfirmedUsableNow(e, at)).toBe(true);
    expect(getAvailabilityStatus(businessEntity({}, { posting: { ...posting, remainingCapacity: 0 } }), at)).toBe('unavailable');
  });
  test('open but unavailable (fresh "full" pulse) is not usable; open + unknown availability is usable as open', () => {
    const partner = { operating_hours: hours(), availability_pulse: 'full', availability_pulse_updated_at: '2026-09-28T16:30:00Z' };
    const e = businessEntity(partner);
    expect(getOperatingStatus(e, at)).toBe('open');
    expect(getAvailabilityStatus(e, at)).toBe('unavailable');
    expect(isConfirmedUsableNow(e, at)).toBe(false);
    expect(usableNowTier(businessEntity({ operating_hours: hours() }), at)).toBe('open');
  });
  test('a stale pulse says nothing; a pulse never overrides closed hours', () => {
    const stale = businessEntity({ availability_pulse: 'open', availability_pulse_updated_at: '2026-09-28T10:00:00Z' });
    expect(getAvailabilityStatus(stale, at)).toBe('unknown');
    const closedButPulse = businessEntity({ operating_hours: hours(), availability_pulse: 'open', availability_pulse_updated_at: '2026-09-29T00:30:00Z' });
    expect(getAvailabilityStatus(closedButPulse, MON_6PM)).toBe('unknown');
    expect(isConfirmedUsableNow(closedButPulse, MON_6PM)).toBe(false);
  });
});

describe('explicit Open now filter', () => {
  const items = [
    { id: 'open', e: businessEntity({ operating_hours: hours() }) },
    { id: 'closed', e: businessEntity({ operating_hours: hours({ mon: 'closed' }) }) },
    { id: 'unknown', e: businessEntity({}) },
  ];
  test('10/11/12. keeps open, drops closed AND unknown; without the filter nothing is hidden', () => {
    expect(filterOpenNow(items, (i) => i.e, MON_10AM).map((i) => i.id)).toEqual(['open']);
    expect(items.map((i) => openNowLift(i.e, MON_10AM))).toEqual([1, 0, 0]); // ranking only: no penalty, no removal
  });
});

describe('existing sources keep working through the same resolver', () => {
  test('14. Google open_now while fresh, unknown once stale or absent', () => {
    const fetchedAt = new Date(MON_10AM.getTime() - 5 * 60000).toISOString();
    expect(getOperatingStatus(placeEntity({ openNow: true, fetchedAt }), MON_10AM)).toBe('open');
    expect(getOperatingStatus(placeEntity({ openNow: false, fetchedAt }), MON_10AM)).toBe('closed');
    expect(getOperatingStatus(placeEntity({ openNow: null, fetchedAt }), MON_10AM)).toBe('unknown');
    const old = new Date(MON_10AM.getTime() - PLACE_OPEN_NOW_FRESH_MS - 1).toISOString();
    expect(getOperatingStatus(placeEntity({ openNow: true, fetchedAt: old }), MON_10AM)).toBe('unknown');
    expect(getOperatingStatus(placeEntity({ openNow: true }), MON_10AM)).toBe('unknown');
  });
  test('gatherings: live window open, upcoming closed, no end past 30 min unknown, full unavailable', () => {
    const at = MON_10AM.getTime();
    const g = (minsAgo, extra = {}) => ({ scheduled_at: new Date(at - minsAgo * 60000).toISOString(), ...extra });
    expect(getOperatingStatus(gatheringEntity(g(10)), MON_10AM)).toBe('open');
    expect(getOperatingStatus(gatheringEntity(g(-60)), MON_10AM)).toBe('closed');
    expect(getOperatingStatus(gatheringEntity(g(90)), MON_10AM)).toBe('unknown');
    expect(getOperatingStatus(gatheringEntity(g(90, { duration_minutes: 120 })), MON_10AM)).toBe('open');
    expect(getOperatingStatus(gatheringEntity(g(150, { duration_minutes: 120 })), MON_10AM)).toBe('closed');
    expect(getAvailabilityStatus(gatheringEntity(g(10, { isFull: true })), MON_10AM)).toBe('unavailable');
    expect(getAvailabilityStatus(gatheringEntity(g(10)), MON_10AM)).toBe('available');
    expect(getAvailabilityStatus(gatheringEntity(g(10, { requires_approval: true })), MON_10AM)).toBe('unknown');
  });
  test('perks: expiry and their own time window (in the business timezone), else the business status', () => {
    const partner = { operating_hours: hours() };
    expect(getOperatingStatus(perkEntity({ expires_at: '2026-09-28T16:00:00Z' }, partner), MON_10AM)).toBe('closed');
    expect(getOperatingStatus(perkEntity({}, partner), MON_10AM)).toBe('open');
    expect(getOperatingStatus(perkEntity({ valid_from_time: '15:00:00', valid_to_time: '17:00:00' }, partner), MON_10AM)).toBe('closed');
    expect(getOperatingStatus(perkEntity({ valid_from_time: '09:00:00', valid_to_time: '11:00:00' }, partner), MON_10AM)).toBe('open');
    // a window with no business timezone confirms nothing
    expect(getOperatingStatus(perkEntity({ valid_from_time: '09:00:00', valid_to_time: '11:00:00' }, {}), MON_10AM)).toBe('unknown');
    expect(getOperatingStatus(perkEntity({}, {}), MON_10AM)).toBe('unknown');
  });
  test('typed-ask candidates map onto the same entities; unknown kinds stay unknown', () => {
    const info = new Map([['p1', { operating_hours: hours() }]]);
    expect(getOperatingStatus(candidateEntity({ type: 'business_policy_match', partnerId: 'p1' }, info), MON_10AM)).toBe('open');
    expect(getOperatingStatus(candidateEntity({ type: 'business_policy_match', partnerId: 'p2' }, info), MON_10AM)).toBe('unknown');
    expect(getOperatingStatus(candidateEntity({ type: 'community', id: 'c' }, info), MON_10AM)).toBe('unknown');
    const avail = candidateEntity({ type: 'business_availability', partnerId: 'p2', postingStartsAt: '2026-09-28T16:00:00Z', postingEndsAt: '2026-09-28T18:00:00Z', matchedAvailability: { remainingCapacity: null } }, info);
    expect(usableNowTier(avail, MON_10AM)).toBe('available');
  });
});

describe('typed asks', () => {
  const evening = new Date(2026, 8, 28, 19, 0);
  const afternoon = new Date(2026, 8, 28, 14, 0);
  test.each([
    "what's open", 'whats open near me', 'anything still open?', 'is it open now', 'open right now coffee',
    'somewhere I can go right now', 'where can I go right now', 'places open for lunch', 'where can we go now',
  ])('turns the filter on: %s', (t) => expect(openNowAskFromText(t, afternoon)).toBe(true));
  test.each([
    'something to do now', 'coffee right now', 'dinner tonight', 'open mic tonight', 'pickleball open play',
    'an open bar', "I'm open to anything", 'open-air concert', "what's open on Sunday", 'is it still open at 10',
    'what time do they open', 'it does not need to be open now',
  ])('12. ordinary "now" / non-hours "open" does not: %s', (t) => expect(openNowAskFromText(t, afternoon)).toBe(false));
  test('"open tonight" counts only once it is already evening', () => {
    expect(openNowAskFromText('bars open tonight', afternoon)).toBe(false);
    expect(openNowAskFromText('bars open tonight', evening)).toBe(true);
  });
});

describe('guards', () => {
  const resolver = read('src/services/intentResolver.js');
  const discover = read('src/screens/DiscoverHubScreen.js');
  test('13. no invented hours: nothing reads a category or "typical hours" into status; the editor starts every day unset', () => {
    const src = read('src/utils/operatingStatus.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src).not.toMatch(/interest_tag|category|TAG_TYPICAL/);
    const editor = read('src/components/BusinessHoursEditor.js');
    expect(editor).toMatch(/blankWeek\(\)/);
    expect(weekHoursLines(null)).toBeNull();
  });
  test('one definition: Discover, typed asks and the profile use operatingStatus, never their own open-now logic', () => {
    expect(resolver).toMatch(/from '\.\.\/utils\/operatingStatus'/);
    expect(resolver).toMatch(/filterOpenNow\(deduped/);
    expect(discover).toMatch(/from '\.\.\/utils\/operatingStatus'/);
    expect(discover).toMatch(/if \(result\.openNowOnly\) setOpenNowOnly\(true\)/);
    for (const f of [discover, resolver]) expect(f).not.toMatch(/openNow\s*===\s*true|open_now\s*===/);
  });
  test('14. no business-facing Open now signal: never stored, sent, or read by business code', () => {
    const payloadFiles = ['src/services/intentOutcomes.js', 'src/services/businessFulfillment.js', 'src/utils/businessOpportunityScoring.js'];
    for (const f of payloadFiles) {
      if (fs.existsSync(path.join(ROOT, f))) expect(read(f)).not.toMatch(/openNow|operatingStatus/);
    }
    const recordCall = resolver.slice(resolver.indexOf('recordIntentSubmission({', resolver.indexOf('export async function runIntentSearch')));
    expect(recordCall.slice(0, 600)).not.toMatch(/openNow/);
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).map((f) => read(`supabase/migrations/${f}`)).join('\n');
    expect(migrations).not.toMatch(/open_now_only|openNowOnly/);
  });
  test('sponsored placements never ride the filter', () => {
    expect(read('src/components/SponsoredSpotlightSlot.js')).not.toMatch(/operatingStatus|openNow/);
    expect(discover).toMatch(/!isSearching && !openNowActive && \(\s*<SponsoredSpotlightSlot/);
  });
  test('15. no new screen, tab or navigation: the chip only toggles state in place', () => {
    const screens = fs.readdirSync(path.join(ROOT, 'src/screens'));
    expect(screens.filter((f) => /open.?now|hours/i.test(f))).toEqual([]);
    const chip = discover.slice(discover.indexOf('function renderOpenNowChip'), discover.indexOf('function renderOpenNowEmpty'));
    expect(chip).toMatch(/setOpenNowOnly/);
    expect(chip).not.toMatch(/navigate/);
  });
  test('Home is unaffected (no Home control or ranking)', () => {
    for (const f of ['src/screens/HomeScreen.js', 'src/services/homeDashboard.js', 'src/utils/homeAttention.js']) {
      expect(read(f)).not.toMatch(/operatingStatus|openNowOnly|filterOpenNow/);
    }
  });
});
