// Owner, 2026-10-17 (scope G1 + G2, migration 20270326): ONE end rule for a gathering (start + duration, else start + 30 min)
// on every surface, and ONE check-in window [start - 30 min, end). The server enforces the same window (journey
// `gatheringCheckIn`); these pin the client side the attending section reads.
import { checkInWindowState, gatheringEndMs, isGatheringOver, CHECK_IN_OPENS_BEFORE_MIN } from './gatheringCompletion';
import { getCountdownLabel } from './gatheringAttending';
import { timeWindowParts } from './timeWindow';

const START = new Date(2026, 9, 17, 18, 0); // 6 PM local
const g = (duration_minutes = 60) => ({ scheduled_at: START.toISOString(), duration_minutes });
const at = (min) => new Date(START.getTime() + min * 60000);

describe('bug 1: the attending section uses the shared end, not a fixed 3 h', () => {
  test('a 1-hour gathering at 6 PM, viewed at 7:30 PM: over everywhere, never "Happening now"', () => {
    const now = at(90);
    expect(isGatheringOver(g(60), now)).toBe(true); // Home's Completed (item 34)
    expect(getCountdownLabel(g(60), now.getTime())).toBeNull(); // the detail screen's line
    expect(checkInWindowState(g(60), now)).toBe('closed'); // so no "I'm here"
  });
  test('during it: "Happening now"; before it: the time left', () => {
    expect(getCountdownLabel(g(60), at(10).getTime())).toBeTruthy();
    expect(getCountdownLabel(g(60), at(10).getTime())).not.toMatch(/\d/);
    expect(getCountdownLabel(g(60), at(-45).getTime())).toMatch(/45/);
  });
  test('the label agrees with timeWindowParts at every minute (one rule)', () => {
    for (const dur of [null, 30, 60, 180]) {
      for (let m = -120; m <= 240; m += 1) {
        const p = timeWindowParts({ start: START.toISOString(), durationMinutes: dur }, at(m), 'event');
        const label = getCountdownLabel(g(dur), at(m).getTime());
        expect([dur, m, label === null]).toEqual([dur, m, p.phase === 'over']);
        expect([dur, m, isGatheringOver(g(dur), at(m))]).toEqual([dur, m, p.phase === 'over']);
      }
    }
  });
  test('the attending section no longer carries its own clock', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'gatheringAttending.js'), 'utf8');
    expect(src).not.toMatch(/HOURS_CONSIDERED_OVER|3600000|60 \* 60/);
    const section = require('fs').readFileSync(require('path').join(__dirname, '../components/GatheringAttendingSection.js'), 'utf8');
    expect(section).toMatch(/const day = attendingDayOf\(gathering\);/);
    expect(section).toMatch(/\{day\.showCheckIn && \(/);
    expect(section).toMatch(/\{day\.showOnMyWay && \(/);
    expect(section).toMatch(/\{day\.showHaveFun \? \(/);
  });
});

describe('bug 2: one check-in window, [start - 30 min, end)', () => {
  test('opens 30 min before the start', () => {
    expect(CHECK_IN_OPENS_BEFORE_MIN).toBe(30);
    expect(checkInWindowState(g(), at(-31))).toBe('before');
    expect(checkInWindowState(g(), new Date(at(-30).getTime() - 1))).toBe('before');
    expect(checkInWindowState(g(), at(-30))).toBe('open');
  });
  test('open during, closed at the end exactly, and after', () => {
    expect(checkInWindowState(g(), at(0))).toBe('open');
    expect(checkInWindowState(g(), at(59))).toBe('open');
    expect(checkInWindowState(g(), new Date(at(60).getTime() - 1))).toBe('open');
    expect(checkInWindowState(g(), at(60))).toBe('closed');
    expect(checkInWindowState(g(), at(61))).toBe('closed');
    expect(checkInWindowState(g(), at(3 * 24 * 60))).toBe('closed');
    expect(checkInWindowState(g(), at(-7 * 24 * 60))).toBe('before');
  });
  test('no duration: ends 30 min after the start (the shared "just started" rule)', () => {
    expect(gatheringEndMs(g(null))).toBe(at(30).getTime());
    expect(checkInWindowState(g(null), at(29))).toBe('open');
    expect(checkInWindowState(g(null), at(30))).toBe('closed');
    expect(isGatheringOver(g(null), at(30))).toBe(true);
    expect(isGatheringOver(g(null), at(29))).toBe(false);
  });
  test('closed exactly when the gathering is over (the same boundary)', () => {
    for (const dur of [null, 45, 60, 120]) {
      for (let m = 0; m <= 200; m += 1) {
        expect([dur, m, checkInWindowState(g(dur), at(m)) === 'closed']).toEqual([dur, m, isGatheringOver(g(dur), at(m))]);
      }
    }
  });
  test('no start: unknown, never offered', () => {
    expect(checkInWindowState({}, at(0))).toBe('unknown');
    expect(checkInWindowState(null, at(0))).toBe('unknown');
  });
  test('the section treats a closed-window refusal as a redraw, never "Try again"', () => {
    const section = require('fs').readFileSync(require('path').join(__dirname, '../components/GatheringAttendingSection.js'), 'utf8');
    expect(section).toMatch(/e\?\.message === 'CHECK_IN_CLOSED'\) await onChanged\?\.\(\)/);
  });
  test('the server mirrors the window and never touches a redemption', () => {
    const sql = require('fs').readFileSync(require('path').join(__dirname, '../../supabase/migrations/20270326_gathering_check_in_window.sql'), 'utf8');
    expect(sql).toMatch(/p_at >= p_scheduled_at - interval '30 minutes' and p_at < public\._gathering_ends_at/);
    expect(sql).toMatch(/coalesce\(p_duration_minutes, 30\)/);
    const body = sql.split('create or replace function public.check_in_to_gathering')[1].split('$function$;')[0];
    expect(body).not.toMatch(/business_request_offers|offer_redemptions|confirmed_at|completed/);
  });
});

// Owner, 2026-10-17 (LOCKED): end = start + duration, else start + 30 min; NOT active at the exact end; check-in closes at
// that same timestamp; Home, Discover, the detail screen (and every other surface) agree. The expected lifecycle state at
// each instant, for a 60-min gathering and one with no duration (end = +30):
//   instant            phase     detail line        Home/Discover card   check-in   Home Completed   Messages chip
//   start - 31 min     upcoming  "Starts in 31 min" "Starts in 31 min"   before     no               -
//   start - 30 min     upcoming  "Starts in 30 min" "Starts in 30 min"   open       no               -
//   start              live      "Happening now"    "Happening now"      open       no               -
//   end - 1 ms         live      "Happening now"    live                 open       no               -
//   end (exact)        over      none               not live             closed     yes              Past
//   end + 1 ms, +3 d   over      none               not live             closed     yes              Past
describe('the exact end boundary: every surface agrees (owner, 2026-10-17, LOCKED)', () => {
  const { whenLabel } = require('./timeContext');
  const { recommendationContext, contextItem } = require('./recommendationContext');
  const { getOperatingStatus, gatheringEntity } = require('./operatingStatus');
  const { strongMatchPieces } = require('./strongMatch');
  const HAPPENING = 'Happening now';
  const iso = START.toISOString();

  const INSTANTS = (dur) => {
    const end = START.getTime() + (dur ?? 30) * 60000;
    return [
      ['start - 31 min', START.getTime() - 31 * 60000, 'upcoming'],
      ['start - 30 min', START.getTime() - 30 * 60000, 'upcoming'],
      ['start', START.getTime(), 'live'],
      ['end - 1 ms', end - 1, 'live'],
      ['end', end, 'over'],
      ['end + 1 ms', end + 1, 'over'],
      ['end + 3 days', end + 3 * 24 * 3600000, 'over'],
    ];
  };

  test.each([[60], [null]])('duration %p: phase, detail line, check-in, Home Completed, operating status', (dur) => {
    for (const [name, t, expected] of INSTANTS(dur)) {
      const now = new Date(t);
      const p = timeWindowParts({ start: iso, durationMinutes: dur }, now, 'event');
      const phase = p.phase === 'ending_soon' ? 'live' : p.phase;
      expect([name, phase]).toEqual([name, expected]);
      // detail screen (attending section)
      const line = getCountdownLabel(g(dur), t);
      expect([name, line === HAPPENING]).toEqual([name, expected === 'live']);
      expect([name, line === null]).toEqual([name, expected === 'over']);
      // Home's Completed + Messages' Past chip (isGatheringOver)
      expect([name, isGatheringOver(g(dur), now)]).toEqual([name, expected === 'over']);
      // check-in: open from -30 min, closed at the exact end
      const ci = checkInWindowState(g(dur), now);
      expect([name, ci]).toEqual([name, name === 'start - 31 min' ? 'before' : expected === 'over' ? 'closed' : 'open']);
      // needs/availability (operatingStatus): open while live, closed when over or upcoming
      expect([name, getOperatingStatus(gatheringEntity(g(dur)), now)]).toEqual([name, expected === 'live' ? 'open' : 'closed']);
    }
  });

  test.each([[60], [null]])('duration %p: Home/Discover card wording (recommendationContext) is live exactly when the detail is', (dur) => {
    for (const [name, t, expected] of INSTANTS(dur)) {
      const now = new Date(t);
      const cardLine = recommendationContext(contextItem('gathering', { id: 'g', scheduled_at: iso, duration_minutes: dur }), { now }).context ?? '';
      expect([name, cardLine.includes(HAPPENING) || /Ends in/.test(cardLine)]).toEqual([name, expected === 'live']);
    }
  });

  test('no duration: whenLabel says "Happening now" up to end - 1 ms, never at the exact end', () => {
    const end = START.getTime() + 30 * 60000;
    expect(whenLabel(iso, new Date(end - 1))).toBe(HAPPENING);
    expect(whenLabel(iso, new Date(end))).not.toBe(HAPPENING);
  });

  test('a strong match is never claimed for a gathering that is over, at the exact end included', () => {
    const ask = { category: 'Coffee', dateWindow: 'today' };
    const item = (dur) => ({ type: 'gathering', category: 'Coffee', startsAt: iso, durationMinutes: dur, distanceMiles: 0.3 });
    expect(strongMatchPieces(item(60), ask, new Date(START.getTime() + 59 * 60000))).not.toBeNull();
    expect(strongMatchPieces(item(60), ask, new Date(START.getTime() + 60 * 60000))).toBeNull();
    expect(strongMatchPieces(item(60), ask, new Date(START.getTime() + 90 * 60000))).toBeNull(); // the old 3 h rule allowed it
    expect(strongMatchPieces(item(null), ask, new Date(START.getTime() + 30 * 60000))).toBeNull();
  });

  test('no surface keeps its own end rule for a gathering', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(read('gatheringAttending.js')).not.toMatch(/HOURS_CONSIDERED_OVER|3600/);
    expect(read('operatingStatus.js')).not.toMatch(/JUST_STARTED_MS|it may still be going/);
    expect(read('strongMatch.js')).toMatch(/item\.type === 'gathering'\) \{\s*if \(timeWindowParts\(/);
    expect(read('timeWindow.js')).toMatch(/nowMs - s < JUST_STARTED_MIN \* 60000/);
    expect(read('timeContext.js')).toMatch(/-diffMs < HAPPENING_NOW_PAST_MS/);
    expect(read('../screens/MessagesScreen.js')).toMatch(/isPast: isGatheringOver\(g\)/);
    expect(read('../screens/HomeScreen.js')).toMatch(/isPast: \(g\) => isGatheringOver\(g\)/);
  });

  test('the "Right Now" discovery window is a separate rule and stays unchanged (inclusive 30 min back)', () => {
    const { isWithinRightNowWindow } = require('./rightNowWindow');
    expect(isWithinRightNowWindow(new Date(START.getTime() - 30 * 60000).toISOString(), START)).toBe(true);
  });
});

// Exact millisecond boundaries on a frozen system clock (owner, 2026-10-17): the helpers are called with NO `now`, exactly as
// the attending section, Home and Discover call them, so the fixed clock is the only clock. 6 PM local on a fixed day.
describe('exact boundaries on a fixed clock (Home, Discover, detail, attendee actions)', () => {
  const { attendingDayOf } = require('./gatheringAttending');
  const { recommendationContext, contextItem } = require('./recommendationContext');
  const { isWithinRightNowWindow } = require('./rightNowWindow');
  const T = (h, m, s = 0, ms = 0) => new Date(2026, 9, 17, h, m, s, ms);
  const SIX = T(18, 0);
  const row = (dur, extra = {}) => ({ id: 'g', scheduled_at: SIX.toISOString(), duration_minutes: dur, ...extra });
  const guest = (dur, checkedIn = false) => row(dur, { isHost: false, myAttendee: { checked_in_at: checkedIn ? T(18, 5).toISOString() : null } });
  const card = (dur) => recommendationContext(contextItem('gathering', row(dur))).context ?? '';
  const live = (txt) => /Happening now|Ends in/.test(txt);
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const at = (d) => jest.setSystemTime(d);

  test.each([
    // [name, instant, duration, active]
    ['A 6:59:59.999 PM', T(18, 59, 59, 999), 60, true],
    ['A 7:00:00.000 PM', T(19, 0, 0, 0), 60, false],
    ['A 7:00:00.001 PM', T(19, 0, 0, 1), 60, false],
    ['B 6:29:59.999 PM', T(18, 29, 59, 999), null, true],
    ['B 6:30:00.000 PM', T(18, 30, 0, 0), null, false],
    ['B 6:30:00.001 PM', T(18, 30, 0, 1), null, false],
  ])('%s: active = %p everywhere', (_name, instant, dur, active) => {
    at(instant);
    // gathering detail: the countdown line and the attendee's actions
    expect(getCountdownLabel(row(dur)) === 'Happening now').toBe(active);
    expect(getCountdownLabel(row(dur)) === null).toBe(!active);
    const d = attendingDayOf(guest(dur));
    expect(d.isOver).toBe(!active);
    expect(d.showOnMyWay).toBe(active);
    expect(d.showCheckIn).toBe(active);
    expect(attendingDayOf(guest(dur, true)).showHaveFun).toBe(active); // "Have fun!" absent at and after the end
    // Home + Discover cards (the one card context engine) and Home's Completed
    expect(live(card(dur))).toBe(active);
    expect(isGatheringOver(row(dur))).toBe(!active);
    if (dur == null) expect(require('./timeContext').whenLabel(SIX.toISOString()) === 'Happening now').toBe(active);
    // check-in
    expect(checkInWindowState(row(dur))).toBe(active ? 'open' : 'closed');
  });

  test.each([
    ['5:29:59.999 PM', T(17, 29, 59, 999), 'before'],
    ['5:30:00.000 PM', T(17, 30, 0, 0), 'open'],
    ['5:30:00.001 PM', T(17, 30, 0, 1), 'open'],
  ])('check-in opening, %s: %s', (_name, instant, state) => {
    at(instant);
    expect(checkInWindowState(row(60))).toBe(state);
    expect(attendingDayOf(guest(60)).showCheckIn).toBe(state === 'open');
    expect(attendingDayOf(guest(60)).showOnMyWay).toBe(true); // "I'm on my way" is not window-bound before the end
  });

  test('the host never gets the guest actions, at any instant', () => {
    for (const instant of [T(17, 30), T(18, 0), T(18, 59, 59, 999)]) {
      at(instant);
      expect(attendingDayOf(row(60, { isHost: true }))).toMatchObject({ showOnMyWay: false, showCheckIn: false });
    }
  });

  test('time zones: the same instant written with any offset decides the same; only the instant matters', () => {
    const offsets = (d) => [d.toISOString(), d.toISOString().replace('Z', '+00:00'),
      new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Kathmandu' }).replace(' ', 'T') + '+05:45',
      new Date(d).toLocaleString('sv-SE', { timeZone: 'Pacific/Marquesas' }).replace(' ', 'T') + '-09:30'];
    for (const iso of offsets(SIX)) expect(new Date(iso).getTime()).toBe(SIX.getTime());
    for (const [instant, state] of [[T(17, 29, 59, 999), 'before'], [T(17, 30), 'open'], [T(18, 59, 59, 999), 'open'], [T(19, 0), 'closed']]) {
      at(instant);
      for (const iso of offsets(SIX)) {
        expect(checkInWindowState({ scheduled_at: iso, duration_minutes: 60 })).toBe(state);
        expect(getCountdownLabel({ scheduled_at: iso, duration_minutes: 60 }) === null).toBe(state === 'closed');
      }
    }
  });

  test('client and server ends cannot differ by duration: the column only allows null or 15-720 min (20270194)', () => {
    // the client's windowEnd ignores a duration under 15 min; the server's _gathering_ends_at uses any duration. The column's
    // CHECK makes those identical, so this guard fails if either side or the constraint changes.
    const fs = require('fs');
    const path = require('path');
    expect(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270194_gathering_equipment_duration.sql'), 'utf8'))
      .toMatch(/check \(duration_minutes is null or duration_minutes between 15 and 720\)/);
    expect(fs.readFileSync(path.join(__dirname, 'timeWindow.js'), 'utf8')).toMatch(/durationMinutes >= 15 \? s \+ durationMinutes \* 60000 : null/);
    expect(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270326_gathering_check_in_window.sql'), 'utf8'))
      .toMatch(/make_interval\(mins => coalesce\(p_duration_minutes, 30\)\)/);
    at(T(18, 14, 59, 999));
    expect(checkInWindowState(row(15))).toBe('open');
    at(T(18, 15));
    expect(checkInWindowState(row(15))).toBe('closed'); // the shortest allowed: ends at +15 on both sides
  });

  test('the "Right Now" discovery window is unchanged: still includes a gathering that started exactly 30 min ago', () => {
    expect(isWithinRightNowWindow(SIX.toISOString(), T(18, 30))).toBe(true);
    expect(isWithinRightNowWindow(SIX.toISOString(), T(18, 30, 0, 1))).toBe(false);
  });
});
