// Owner 2026-10-27: Tonight sets the day only on every path into Create; the person picks the clock time (never 7 PM filled in).
const fs = require('fs');
const path = require('path');
const { presetLeavesTime } = require('./whenPresets');

const screen = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');

describe('Tonight leaves the time to the person', () => {
  test('only Tonight leaves the time', () => {
    expect(presetLeavesTime('tonight')).toBe(true);
    ['now', 'tomorrow', 'custom', null].forEach((p) => expect(presetLeavesTime(p)).toBe(false));
  });

  test("Create's own Tonight tap sets the day and asks for the time", () => {
    const pick = screen.slice(screen.indexOf('function pickPreset('), screen.indexOf('function pickVisibility('));
    expect(pick).toMatch(/if \(presetLeavesTime\(preset\)\) \{ leaveTimeOnDay\(new Date\(\)\); return; \}\s*setScheduledAt\(dateForPreset\(preset\)\)/);
  });

  test('a carried Tonight with no date or time also asks for the time', () => {
    const effect = screen.slice(screen.indexOf('route.params?.quickStartWhenPreset) {'), screen.indexOf('function leaveTimeOnDay('));
    expect(effect).toMatch(/else if \(presetLeavesTime\(preset\)\) \{\s*leaveTimeOnDay\(new Date\(\)\);/);
  });

  test('leaving the time marks it unpicked (Next blocked until picked)', () => {
    const fn = screen.slice(screen.indexOf('function leaveTimeOnDay('), screen.indexOf('function pickTimeOnDay('));
    expect(fn).toMatch(/setTimeNeeded\(true\)/);
  });
});
