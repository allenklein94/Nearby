// Idea "395" (owner, 2026-10-24): an expired request never shows a button the server must refuse.
import fs from 'fs';
import path from 'path';
import { expiredRequestAction, askAgainTomorrowParams, requestOwnDeadline, isReopenTimePassedError } from './requestAskAgain';

const ME = 'me';
// Local wall-clock fixtures (never a UTC Z string): Saturday 2026-10-24, 4:00 PM local.
const NOW = new Date(2026, 9, 24, 16, 0);
const req = (over = {}) => ({ id: 'r1', requester_id: ME, status: 'expired', date: null, time_window_start: null, time_window_end: null, ...over });
const act = (r, opts = {}) => expiredRequestAction(r, { viewerId: ME, now: NOW, ...opts });

describe('expiredRequestAction: reopen only while the request\'s own time is ahead', () => {
  test('no day: always reopenable (the server gives 48 h)', () => {
    expect(act(req())).toBe('reopen');
  });
  test('a later day, or today with a start still ahead: reopen', () => {
    expect(act(req({ date: '2026-10-25' }))).toBe('reopen');
    expect(act(req({ date: '2026-10-24', time_window_start: '19:00:00' }))).toBe('reopen');
    expect(act(req({ date: '2026-10-24' }))).toBe('reopen'); // no time = until 23:59:59 local
  });
  test('the day/time has passed: ask again for tomorrow, never Reopen', () => {
    expect(act(req({ date: '2026-10-23' }))).toBe('ask_again_tomorrow');
    expect(act(req({ date: '2026-10-24', time_window_start: '09:00:00' }))).toBe('ask_again_tomorrow');
    expect(act(req({ date: '2026-10-24', time_window_start: '16:00:00' }))).toBe('ask_again_tomorrow'); // closed AT it
  });
  test('the window end counts when there is no start (server: coalesce(start, end, 23:59:59))', () => {
    expect(requestOwnDeadline(req({ date: '2026-10-24', time_window_end: '15:30' }))).toEqual(new Date(2026, 9, 24, 15, 30));
    expect(act(req({ date: '2026-10-24', time_window_end: '15:30' }))).toBe('ask_again_tomorrow');
    expect(act(req({ date: '2026-10-24', time_window_end: '21:00' }))).toBe('reopen');
  });
  test('a server refusal ("time has passed") is final: no Reopen again', () => {
    expect(act(req({ date: '2026-10-25' }), { serverRefusedReopen: true })).toBe('ask_again_tomorrow');
    expect(isReopenTimePassedError(new Error('The time for this request has passed. Start a new one with a new time.'))).toBe(true);
    expect(isReopenTimePassedError(new Error('Network request failed'))).toBe(false);
  });
});

describe('gathering-linked requests stay on the gathering\'s own path', () => {
  const g = req({ gathering_id: 'g1', date: '2026-10-23' });
  test('reopen while the gathering is still ahead', () => {
    expect(act(g, { gatheringStartsAt: new Date(2026, 9, 25, 10).toISOString() })).toBe('reopen');
  });
  test('started, unknown start or refused: nothing (rescheduling the gathering is the path), never ask-again', () => {
    expect(act(g, { gatheringStartsAt: new Date(2026, 9, 24, 15).toISOString() })).toBeNull();
    expect(act(g, { gatheringStartsAt: null })).toBeNull();
    expect(act(g, { gatheringStartsAt: new Date(2026, 9, 25, 10).toISOString(), serverRefusedReopen: true })).toBeNull();
  });
});

describe('who and which state', () => {
  test('only the requester, only an expired request', () => {
    expect(expiredRequestAction(req({ date: '2026-10-23' }), { viewerId: 'someone-else', now: NOW })).toBeNull();
    expect(act(req({ status: 'open', date: '2026-10-23' }))).toBeNull();
    expect(act(req({ status: 'cancelled', date: '2026-10-23' }))).toBeNull();
    expect(act(req({ status: 'fulfilled', date: '2026-10-23' }))).toBeNull();
  });
  test('match / community / plan / add-on requests whose time passed keep their own flows (no ask-again)', () => {
    for (const k of ['match_id', 'community_id', 'group_plan_id', 'parent_request_id']) {
      expect(act(req({ date: '2026-10-23', [k]: 'x' }))).toBeNull();
    }
  });
});

describe('askAgainTomorrowParams: the existing form, prefilled, Tomorrow selected', () => {
  const expired = req({
    raw_text: 'quiet coffee spot to work', category: 'Coffee', party_size: 3, budget_max: 25, radius_miles: 30, date: '2026-10-23',
    time_window_start: '19:00:00', occasion: 'birthday', experience_level: 'go_all_out', cuisine: 'Italian', dietary: ['vegan'],
    requested_items: ['cake'], target_partner_id: 'biz-1', note_for_business: 'ring the bell',
  });
  test('carries what the person stated, with Tomorrow', () => {
    expect(askAgainTomorrowParams(expired, NOW)).toEqual({
      prefillText: 'quiet coffee spot to work', prefillCategory: 'Coffee', prefillPartySize: 3, prefillBudgetMax: 25,
      prefillDateWindow: 'tomorrow', prefillStartMinutes: 19 * 60, prefillRadiusMiles: 30, prefillOccasion: 'birthday',
      prefillExperienceLevel: 'go_all_out', prefillCuisine: 'Italian', prefillDietary: ['vegan'], prefillRequestedItems: ['cake'],
    });
  });
  test('never the original businesses or the one-business note: Send asks nearby businesses again (normal matching)', () => {
    const p = askAgainTomorrowParams(expired, NOW);
    expect(p).not.toHaveProperty('targetPartner');
    expect(p).not.toHaveProperty('matchedAvailability');
    expect(JSON.stringify(p)).not.toMatch(/biz-1|ring the bell/);
  });
  test('words naming a day are not carried (a "tonight" box beside Tomorrow would contradict it); the form asks again', () => {
    for (const w of ['coffee tonight', 'coffee today at 7', 'brunch tomorrow', 'pickleball friday', 'dinner on November 4', 'drinks this weekend', 'coffee now']) {
      expect(askAgainTomorrowParams({ ...expired, raw_text: w }, NOW).prefillText).toBeNull();
    }
    expect(askAgainTomorrowParams({ ...expired, raw_text: 'coffee in the morning' }, NOW).prefillText).toBe('coffee in the morning');
  });
  test('time: the stated start only (never a window end, never invented); none stated = none', () => {
    expect(askAgainTomorrowParams({ ...expired, time_window_start: null, time_window_end: '21:00' }, NOW).prefillStartMinutes).toBeNull();
    expect(askAgainTomorrowParams({ ...expired, time_window_start: null }, NOW).prefillStartMinutes).toBeNull();
    expect(askAgainTomorrowParams({ ...expired, time_window_start: '07:30' }, new Date(2026, 9, 24, 23, 59)).prefillStartMinutes).toBe(450);
  });
  test('empty lists and missing fields stay empty (missing stays missing)', () => {
    const p = askAgainTomorrowParams(req({ category: 'Coffee', dietary: [], requested_items: null }), NOW);
    expect(p.prefillDietary).toBeNull();
    expect(p.prefillRequestedItems).toBeNull();
    expect(p.prefillPartySize).toBeNull();
    expect(p.prefillText).toBeNull();
  });
});

describe('wiring (source guard)', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'screens', f), 'utf8');
  const detail = read('BusinessRequestDetailScreen.js');
  test('the request screen decides through the one rule, never a raw canDo(reopen) button', () => {
    expect(detail).toMatch(/expiredRequestAction\(request,/);
    expect(detail).toMatch(/askAgainTomorrowParams\(request\)/);
    expect(detail).not.toMatch(/canDo\('request', request\.status, 'reopen'\) && request\.requester_id === myId && \(/);
    expect(detail).toMatch(/isReopenTimePassedError\(e\)/);
  });
  test('the form reads the three new prefills', () => {
    const ask = read('AskBusinessScreen.js');
    for (const k of ['prefillCuisine', 'prefillDietary', 'prefillRequestedItems']) expect(ask).toContain(`route.params?.${k}`);
  });
});
