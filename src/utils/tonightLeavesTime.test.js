// Owner 2026-10-27: Tonight sets the day only on every path into Create; the person picks the clock time (never 7 PM filled in).
const fs = require('fs');
const path = require('path');
const { presetLeavesTime, dayForPreset } = require('./whenPresets');

const screen = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');

describe('Tonight leaves the time to the person', () => {
  test('Tonight and Tomorrow leave the time (device test 2026-11-27: Tomorrow no longer fills noon)', () => {
    expect(presetLeavesTime('tonight')).toBe(true);
    expect(presetLeavesTime('tomorrow')).toBe(true);
    ['now', 'custom', null].forEach((p) => expect(presetLeavesTime(p)).toBe(false));
  });

  test("Create's own Tonight tap sets the day and asks for the time", () => {
    const pick = screen.slice(screen.indexOf('function pickPreset('), screen.indexOf('function pickVisibility('));
    expect(pick).toMatch(/if \(presetLeavesTime\(preset\)\) \{ leaveTimeOnDay\(dayForPreset\(preset\)\); return; \}\s*setScheduledAt\(dateForPreset\(preset\)\)/);
  });

  test('a carried Tonight with no date or time also asks for the time', () => {
    const effect = screen.slice(screen.indexOf('route.params?.quickStartWhenPreset) {'), screen.indexOf('function leaveTimeOnDay('));
    expect(effect).toMatch(/else if \(presetLeavesTime\(preset\)\) \{\s*leaveTimeOnDay\(dayForPreset\(preset\)\);/);
  });

  test('leaving the time marks it unpicked (Next blocked until picked)', () => {
    const fn = screen.slice(screen.indexOf('function leaveTimeOnDay('), screen.indexOf('function pickTimeOnDay('));
    expect(fn).toMatch(/setTimeNeeded\(true\)/);
  });

  test('the day each preset names: Tonight = today, Tomorrow = the next local day (month end included)', () => {
    const now = new Date(2026, 10, 30, 22, 15);
    expect(dayForPreset('tonight', now).getDate()).toBe(30);
    const t = dayForPreset('tomorrow', now);
    expect([t.getFullYear(), t.getMonth(), t.getDate()]).toEqual([2026, 11, 1]);
  });
});
