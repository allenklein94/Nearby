// Idea "397" (owner, 2026-10-24): past plans become history; time governs, nothing is invented, a passed time never claims a visit.
import fs from 'fs';
import path from 'path';
import { businessPlanPlacement, experiencePlanTab, untimedPlanTab, orderPlanRows } from './planHistory';
import { PLAN_STATUS } from '../constants/planStatus';

// Local wall-clock fixtures (never a UTC Z string for local times): Saturday 2026-10-24, 4:00 PM local.
const NOW = new Date(2026, 9, 24, 16, 0);
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const plan = (status, req) => ({ id: 'p', status, scheduled_at: req?.date ? `${req.date}T00:00:00+00:00` : null, business_requests: req });
const request = (over = {}) => ({ status: 'open', date: null, time_window_start: null, expires_at: null, gatherings: null, business_request_offers: [], ...over });
const booked = (offer, over = {}) => request({ status: 'fulfilled', business_request_offers: [{ status: 'offered', proposed_time: null }, offer], ...over });
const place = (p, now = NOW) => businessPlanPlacement(p, now);

describe('bookings: the visit time decides, never the stored status alone', () => {
  test('future booking stays Upcoming, even with the visit already confirmed', () => {
    expect(place(plan('confirmed', booked({ status: 'accepted', proposed_time: at(25, 19) })))).toEqual({ tab: 'upcoming', status: PLAN_STATUS.CONFIRMED, closed: false });
    expect(place(plan('completed', booked({ status: 'completed', proposed_time: at(24, 19) })))).toEqual({ tab: 'upcoming', status: PLAN_STATUS.COMPLETED, closed: false });
  });
  test('past booking moves to Past and keeps "Confirmed": a passed time never claims a visit', () => {
    expect(place(plan('confirmed', booked({ status: 'accepted', proposed_time: at(23, 19) })))).toEqual({ tab: 'past', status: PLAN_STATUS.CONFIRMED, closed: false });
  });
  test('visit confirmed after its time: Past with Completed', () => {
    expect(place(plan('completed', booked({ status: 'completed', proposed_time: at(24, 10) })))).toEqual({ tab: 'past', status: PLAN_STATUS.COMPLETED, closed: false });
  });
  test('boundary: Past exactly AT the booked time, Upcoming a minute before', () => {
    const p = plan('confirmed', booked({ status: 'accepted', proposed_time: at(24, 16) }));
    expect(place(p, NOW).tab).toBe('past');
    expect(place(p, new Date(2026, 9, 24, 15, 59)).tab).toBe('upcoming');
  });
  test('no accepted time: the request day + start, else the whole day (existing visitHasPassed)', () => {
    const offer = { status: 'accepted', proposed_time: null };
    expect(place(plan('confirmed', booked(offer, { date: '2026-10-24', time_window_start: '15:00:00' }))).tab).toBe('past');
    expect(place(plan('confirmed', booked(offer, { date: '2026-10-24', time_window_start: '19:00:00' }))).tab).toBe('upcoming');
    expect(place(plan('confirmed', booked(offer, { date: '2026-10-24' }))).tab).toBe('upcoming'); // date only: until the day ends
    expect(place(plan('confirmed', booked(offer, { date: '2026-10-24' })), new Date(2026, 9, 25, 0, 0)).tab).toBe('past');
  });
  test('no time on record at all: stays Upcoming (never invented)', () => {
    expect(place(plan('confirmed', booked({ status: 'accepted', proposed_time: null }))).tab).toBe('upcoming');
  });
  test('a cancelled booking is not listed (unchanged)', () => {
    expect(place(plan('cancelled', booked({ status: 'accepted', proposed_time: at(23, 19) })))).toBeNull();
  });
});

describe('requests with no booking: the request\'s own state decides', () => {
  test('open = Upcoming, Pending', () => {
    expect(place(plan('draft', request({ expires_at: at(25, 12) })))).toEqual({ tab: 'upcoming', status: PLAN_STATUS.PENDING, closed: false });
  });
  test('expired = Past, "Request expired", no badge (its plan row is stored cancelled on expiry)', () => {
    expect(place(plan('cancelled', request({ status: 'expired' })))).toEqual({ tab: 'past', status: null, closed: true });
  });
  test('past its deadline before the hourly sweep = expired already; Upcoming a minute before', () => {
    const p = plan('draft', request({ expires_at: at(24, 16) }));
    expect(place(p, NOW)).toEqual({ tab: 'past', status: null, closed: true });
    expect(place(p, new Date(2026, 9, 24, 15, 59)).tab).toBe('upcoming');
  });
  test('reopened (request open again, plan still stored cancelled) = Upcoming, Pending, not a "Cancelled" badge', () => {
    expect(place(plan('cancelled', request({ expires_at: at(26, 12) })))).toEqual({ tab: 'upcoming', status: PLAN_STATUS.PENDING, closed: false });
  });
  test('cancelled by the person = not listed', () => {
    expect(place(plan('cancelled', request({ status: 'cancelled' })))).toBeNull();
  });
  test('an expired reply on an expired request is not a booking', () => {
    expect(place(plan('cancelled', request({ status: 'expired', business_request_offers: [{ status: 'expired' }, { status: 'declined' }] }))).tab).toBe('past');
  });
});

describe('night-out, date and shared plans', () => {
  // set_experience_night_date stores (date 12:00) UTC
  const night = (date, status = 'confirmed') => ({ status, scheduled_at: date ? `${date}T12:00:00+00:00` : null });
  test('night out: Upcoming through its night\'s date, Past once that day has ended', () => {
    expect(experiencePlanTab(night('2026-10-25'), NOW)).toBe('upcoming');
    expect(experiencePlanTab(night('2026-10-24'), NOW)).toBe('upcoming');
    expect(experiencePlanTab(night('2026-10-24'), new Date(2026, 9, 25, 0, 0))).toBe('past');
    expect(experiencePlanTab(night('2026-10-23'), NOW)).toBe('past');
  });
  test('night out: completed with a future date stays Upcoming; no date = Past only when completed', () => {
    expect(experiencePlanTab(night('2026-10-30', 'completed'), NOW)).toBe('upcoming');
    expect(experiencePlanTab(night(null, 'completed'), NOW)).toBe('past');
    expect(experiencePlanTab(night(null, 'draft'), NOW)).toBe('upcoming');
  });
  test('date / hangout plans and shared nights carry no time: Past only when completed', () => {
    expect(untimedPlanTab({ status: 'confirmed' })).toBe('upcoming');
    expect(untimedPlanTab({ status: 'draft' })).toBe('upcoming');
    expect(untimedPlanTab({ status: 'completed' })).toBe('past');
  });
});

test('order: Past most recent first, untimed rows after, stable', () => {
  const rows = [{ id: 'a', t: at(20, 10) }, { id: 'b', t: null }, { id: 'c', t: at(23, 10) }, { id: 'd', t: at(21, 10) }];
  expect(orderPlanRows(rows, 'past', (r) => r.t).map((r) => r.id)).toEqual(['c', 'd', 'a', 'b']);
  expect(orderPlanRows(rows, 'upcoming', (r) => r.t).map((r) => r.id)).toEqual(['a', 'd', 'c', 'b']);
});

describe('wiring (source guard)', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'screens', 'PlansScreen.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'plans.js'), 'utf8');
  test('Plans places these rows only through the one rule, on Upcoming and Past', () => {
    expect(screen).toMatch(/businessPlanPlacement\(plan, now\)/);
    expect(screen).toMatch(/experiencePlanTab\(x, now\) === tab/);
    expect(screen).toMatch(/untimedPlanTab\(x\) === tab/);
    expect(screen).toMatch(/tab === 'upcoming' \|\| tab === 'past'/);
    expect(screen).toMatch(/status=\{item\.place\.status\}/);
    expect(screen).toMatch(/ui\.actions\.requestExpired/);
  });
  test('the read carries what the rule needs and no longer drops expired requests\' cancelled plan rows', () => {
    const fn = service.slice(service.indexOf('export async function getMyStandaloneBusinessRequestPlans'), service.indexOf('export async function getMyDateProposalPlans'));
    expect(fn).toMatch(/status, date, time_window_start, expires_at/);
    expect(fn).toMatch(/business_request_offers!business_request_offers_request_id_fkey\(status, proposed_time\)/);
    expect(fn).not.toMatch(/neq\('status', 'cancelled'\)/);
    // the self-embed must use the column hint (the constraint-name form is refused by PostgREST: PGRST200)
    expect(fn).toMatch(/parent:plans!parent_plan_id\(plan_type\)/);
    expect(fn).not.toMatch(/plans!plans_parent_plan_id_fkey/);
    expect(service).toMatch(/select\('id, title, status, scheduled_at'\)\s*\n\s*\.eq\('plan_type', 'experience'\)/);
  });
});
