const fs = require('fs');
const path = require('path');
const { pinFrameStart, toOverlayPoint, PIN_HEAD_LIFT } = require('./pinToSheet');
const { SEQUENCES, settleMs, tierOf, MOTION_BUDGET } = require('./motionBudget');

// Owner item 44 (2026-10-11): a business pin on Discover's map grows into its business sheet.
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sheet = read('src/components/BusinessPreviewSheet.js');
const frameWrapper = read('src/motion/PinToSheetFrame.js');
// item 55: the frame is the Nearby Pulse's journey form; its drawing lives in PulseJourney
const pulseSrc = read('src/motion/NearbyPulse.js');
const frame = pulseSrc.slice(pulseSrc.indexOf('export function PulseJourney'), pulseSrc.indexOf('const styles = StyleSheet.create'));
const map = read('src/components/GatheringsMapView.js');

describe('geometry', () => {
  const rect = { x: 0, y: 500, width: 400, height: 300 };
  test('the frame starts as a pin-sized square centred exactly on the pin', () => {
    const pin = { x: 120, y: 200 };
    const s = pinFrameStart(pin, rect, 28);
    // scale about the centre, then translate: the start centre is the rect centre moved by the translation
    expect(rect.x + rect.width / 2 + s.translateX).toBe(pin.x);
    expect(rect.y + rect.height / 2 + s.translateY).toBe(pin.y);
    expect(s.scaleX * rect.width).toBeCloseTo(28);
    expect(s.scaleY * rect.height).toBeCloseTo(28);
  });
  test('never starts larger than the sheet', () => {
    const s = pinFrameStart({ x: 0, y: 0 }, { x: 0, y: 0, width: 20, height: 10 }, 28);
    expect(s.scaleX).toBe(1);
    expect(s.scaleY).toBe(1);
  });
  test('anything unknown = no frame (the sheet still opens)', () => {
    expect(pinFrameStart(null, rect, 28)).toBeNull();
    expect(pinFrameStart({ x: 1, y: 2 }, null, 28)).toBeNull();
    expect(pinFrameStart({ x: NaN, y: 2 }, rect, 28)).toBeNull();
    expect(pinFrameStart({ x: 1, y: 2 }, { ...rect, width: 0 }, 28)).toBeNull();
  });
  test('window spot -> overlay coordinates', () => {
    expect(toOverlayPoint({ x: 100, y: 300 }, { x: 0, y: 24 })).toEqual({ x: 100, y: 276 });
    expect(toOverlayPoint(null, { x: 0, y: 0 })).toBeNull();
    expect(toOverlayPoint({ x: 1, y: 1 }, null)).toBeNull();
  });
  test('the frame starts at the pin head, above the coordinate tip', () => {
    expect(PIN_HEAD_LIFT).toBeGreaterThan(0);
    expect(map).toMatch(/y: off\.y \+ pt\.y - PIN_HEAD_LIFT/);
  });
});

describe('budget', () => {
  test('a medium-tier transition; the wait for the pin spot is a short hold, not part of it', () => {
    const T = SEQUENCES.pinToSheet;
    expect(T.tier).toBe('medium');
    expect(tierOf(settleMs('pinToSheet'))).toBe('medium');
    expect(T.originWaitMs).toBeLessThanOrEqual(MOTION_BUDGET.tiny.max);
  });
});

describe('never delays or blocks the person', () => {
  test('the sheet opens at the tap: its content is never below the info floor and nothing waits to render', () => {
    expect(sheet).toMatch(/opacity: infoOpacity\(grow\)/);
    expect(sheet).not.toMatch(/disabled=/);
    // the pin spot is awaited only to START the motion; the content renders regardless
    expect(sheet).toMatch(/setTimeout\(\(\) => start\(null\), PIN\.originWaitMs\)/);
  });
  test('the frame is an outline only and takes no touches', () => {
    expect(frame).toMatch(/pointerEvents="none"/);
    expect(frameWrapper).toMatch(/<PulseJourney origin=\{pin\} rect=\{rect\} tokens=\{JOURNEY\} color=\{BUSINESS_PIN_COLOR\} borderRadius=\{radius\.lg\} borderWidth=\{2\} play=\{!reduceMotion\} \/>/);
    expect(frame).not.toMatch(/backgroundColor/);
  });
  test('native driver for every timing', () => {
    for (const src of [sheet, frame]) {
      const timings = (src.match(/Animated\.timing\(/g) || []).length;
      expect(timings).toBeGreaterThan(0);
      expect((src.match(/useNativeDriver: true/g) || []).length).toBe(timings);
      expect(src).not.toMatch(/useNativeDriver: false/);
    }
  });
});

describe('scope', () => {
  test('only a map pin opening plays it; Reduce Motion keeps the plain modal animation', () => {
    expect(sheet).toMatch(/const fromPin = !!pinSpot && !reduceMotion;/);
    expect(sheet).toMatch(/animationType=\{fromPin \? 'none' : modalAnimation\('slide'\)\}/);
    expect(sheet).toMatch(/\{fromPin && pin && sheetRect \? <PinToSheetFrame/);
  });
  test('the pin colour has one source shared by the map and the frame', () => {
    expect(map).toMatch(/pinColor=\{BUSINESS_PIN_COLOR\}/);
    expect(map).not.toMatch(/#5B9AA0/);
  });
});
