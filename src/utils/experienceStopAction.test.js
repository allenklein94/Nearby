// Owner idea "383": a plan stop's link names where it goes (never "Continue"), and the label and the navigation read ONE rule.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { experienceStopAction, experienceStopDestination } = require('./primaryAction');
const { navigateToExperienceStop } = require('../services/plans');

const biz = (over = {}) => ({ id: 's1', stopType: 'business_availability', refId: 'a1', title: 'Chef tasting', ...over });
const opened = (stop) => { const navigate = jest.fn(); navigateToExperienceStop({ navigate }, stop); return navigate.mock.calls[0][0]; };
const SCREEN = { gathering: 'GatheringDetail', request: 'BusinessRequestDetail', ask: 'AskBusiness' };

describe('experienceStopAction (idea 383)', () => {
  test('gathering stop = View, opens the gathering', () => {
    const stop = { stopType: 'gathering', refId: 'g1', title: 'Trivia' };
    expect(experienceStopAction(stop)).toEqual({ kind: 'view_gathering', label: 'View →' });
    expect(opened(stop)).toBe('GatheringDetail');
  });

  test.each(['requested', 'offer_received', 'booked', 'done'])('%s stop = View, opens its request, never a new booking', (state) => {
    const stop = biz({ requestId: 'r1', state, bookingMode: 'reservation_required' });
    expect(experienceStopAction(stop)).toEqual({ kind: 'view_request', label: 'View →' });
    expect(opened(stop)).toBe('BusinessRequestDetail');
  });

  test.each([
    ['reservation_recommended', 'reserve', 'Reserve'],
    ['reservation_required', 'book', 'Book'],
    ['request_required', 'request', 'Request'],
    ['walk_in', 'request', 'Request'],
    [null, 'request', 'Request'],
  ])('not requested yet, mode %s = %s, opens a request to that business', (mode, kind, label) => {
    const stop = biz({ state: 'chosen', bookingMode: mode });
    expect(experienceStopAction(stop)).toEqual({ kind, label });
    expect(opened(stop)).toBe('AskBusiness');
  });

  test('legacy reservation_required attribute reads as Book (bookingModeOf)', () => {
    expect(experienceStopAction(biz({ state: 'chosen', partnerAttributes: ['reservation_required'] })).label).toBe('Book');
  });

  test('cancelled request = a new request, labelled by booking mode', () => {
    const stop = biz({ requestId: 'r1', state: 'cancelled', bookingMode: 'reservation_recommended' });
    expect(experienceStopAction(stop).label).toBe('Reserve');
    expect(opened(stop)).toBe('AskBusiness');
  });

  test('label kind always agrees with the screen navigation opens', () => {
    const stops = [{ stopType: 'gathering', refId: 'g' }, biz({ requestId: 'r', state: 'booked' }), biz({ state: 'chosen' }), biz({ requestId: 'r', state: 'cancelled' })];
    for (const s of stops) expect(opened(s)).toBe(SCREEN[experienceStopDestination(s)]);
  });

  test('no stop link label says Continue', () => {
    const fs = require('fs');
    const screen = fs.readFileSync(require.resolve('../screens/PlanDetailScreen.js'), 'utf8');
    expect(screen).not.toMatch(/planDetail\.continue/);
    expect(screen).toMatch(/experienceStopAction\(s\)\.label/);
  });
});
