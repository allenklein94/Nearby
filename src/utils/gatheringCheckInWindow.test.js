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
    expect(section).toMatch(/const isOver = isGatheringOver\(gathering\);/);
    expect(section).toMatch(/\{checkInOpen && \(/);
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
