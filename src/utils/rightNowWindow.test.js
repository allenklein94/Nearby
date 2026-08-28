// Universal Signal Remediation Pass, P2 item 8 (CLAUDE.md, Aug 28 2026):
// unit tests for the one real canonical "Right Now" window definition --
// run anywhere, no device/network needed, matching timeContext.test.js's
// own established convention for a pure utility file.
const { isWithinRightNowWindow, RIGHT_NOW_WINDOW_PAST_MS, RIGHT_NOW_WINDOW_FUTURE_MS } = require('./rightNowWindow');

describe('isWithinRightNowWindow', () => {
  const now = new Date('2026-08-12T12:00:00Z');

  it('matches something that started just under 30 minutes ago', () => {
    const justStarted = new Date(now.getTime() - RIGHT_NOW_WINDOW_PAST_MS + 60 * 1000);
    expect(isWithinRightNowWindow(justStarted, now)).toBe(true);
  });

  it('matches something starting just under 2 hours from now', () => {
    const startingSoon = new Date(now.getTime() + RIGHT_NOW_WINDOW_FUTURE_MS - 60 * 1000);
    expect(isWithinRightNowWindow(startingSoon, now)).toBe(true);
  });

  it('excludes something that started more than 30 minutes ago', () => {
    const tooLongAgo = new Date(now.getTime() - RIGHT_NOW_WINDOW_PAST_MS - 60 * 1000);
    expect(isWithinRightNowWindow(tooLongAgo, now)).toBe(false);
  });

  it('excludes something starting more than 2 hours from now', () => {
    const tooFarAhead = new Date(now.getTime() + RIGHT_NOW_WINDOW_FUTURE_MS + 60 * 1000);
    expect(isWithinRightNowWindow(tooFarAhead, now)).toBe(false);
  });

  it('matches the exact boundaries, inclusive', () => {
    const exactPastBoundary = new Date(now.getTime() - RIGHT_NOW_WINDOW_PAST_MS);
    const exactFutureBoundary = new Date(now.getTime() + RIGHT_NOW_WINDOW_FUTURE_MS);
    expect(isWithinRightNowWindow(exactPastBoundary, now)).toBe(true);
    expect(isWithinRightNowWindow(exactFutureBoundary, now)).toBe(true);
  });

  it('defaults `now` to the real current time when not supplied', () => {
    expect(isWithinRightNowWindow(new Date().toISOString())).toBe(true);
  });
});
