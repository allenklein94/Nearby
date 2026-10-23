// Owner idea "346" (2026-10-23, approved): every map pin type is told apart by a glyph, not by colour alone; colours,
// placement, taps, stacking and screen-reader labels unchanged; no new strings, no motion.
const fs = require('fs');
const path = require('path');
import { mapPinGlyph, LIVE_BADGE_GLYPH, PERK_PIN_GLYPH, BUSINESS_PIN_GLYPH, PIN_HEAD, PIN_TAIL } from './mapPinGlyph';
import { PIN_HEAD_LIFT } from '../motion/pinToSheet';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const map = read('components/GatheringsMapView.js');
const pin = read('components/MapGlyphPin.js');

describe('one glyph per pin type', () => {
  test('gathering = its category icon, no badge', () => {
    expect(mapPinGlyph({ kind: 'gathering', categoryIcon: categoryStyleFor('Coffee').icon })).toEqual({ glyph: '☕', badge: null });
  });
  test('live gathering = the same category icon + the live badge', () => {
    expect(mapPinGlyph({ kind: 'gathering', live: true, categoryIcon: '☕' })).toEqual({ glyph: '☕', badge: LIVE_BADGE_GLYPH });
  });
  test('perk = 🎁, business = 🏪, never a live badge', () => {
    expect(mapPinGlyph({ kind: 'perk', live: true })).toEqual({ glyph: PERK_PIN_GLYPH, badge: null });
    expect(mapPinGlyph({ kind: 'business', live: true })).toEqual({ glyph: BUSINESS_PIN_GLYPH, badge: null });
  });
  test('a gathering without a category icon still gets a glyph', () => {
    expect(mapPinGlyph({ kind: 'gathering' }).glyph).toBeTruthy();
  });
  test('the four types never share a glyph + badge combination', () => {
    const combos = [
      mapPinGlyph({ kind: 'gathering', categoryIcon: '☕' }),
      mapPinGlyph({ kind: 'gathering', live: true, categoryIcon: '☕' }),
      mapPinGlyph({ kind: 'perk' }),
      mapPinGlyph({ kind: 'business' }),
    ].map((c) => `${c.glyph}|${c.badge}`);
    expect(new Set(combos).size).toBe(4);
  });
  test('the glyphs are ones Nearby already uses for those types (no new symbols)', () => {
    expect(require('../i18n/ui/mapView').default.en.liveNow).toContain(LIVE_BADGE_GLYPH);
    expect(map).toMatch(/🎁 \{d\.title\}/);
    expect(read('screens/BusinessProfileScreen.js')).toContain(BUSINESS_PIN_GLYPH);
  });
});

describe('geometry: item 44 still starts from the pin head', () => {
  test('head centre sits PIN_HEAD_LIFT above the tip', () => {
    expect(PIN_TAIL + PIN_HEAD / 2).toBe(PIN_HEAD_LIFT);
  });
  test('glyph pins are anchored at the tip, bottom-centre', () => {
    expect(map).toMatch(/const PIN_ANCHOR = \{ x: 0\.5, y: 1 \};/);
    for (const kind of ['gathering', 'perk', 'business']) {
      const at = map.indexOf(`<MapGlyphPin kind="${kind}"`);
      expect(at).toBeGreaterThan(-1);
      expect(map.slice(Math.max(0, at - 700), at)).toMatch(/anchor=\{PIN_ANCHOR\}/);
    }
  });
});

describe('map behaviour unchanged', () => {
  test('colours kept: live red, category colour, perk amber, business teal (one source)', () => {
    expect(map).toMatch(/const LIVE_PIN_COLOR = '#e63946';/);
    expect(map).toMatch(/const PERK_PIN_COLOR = '#f59e0b';/);
    expect(map).toMatch(/color=\{live \? LIVE_PIN_COLOR : categoryStyle\.color\}/);
    expect(map).toMatch(/<MapGlyphPin kind="perk" color=\{PERK_PIN_COLOR\} \/>/);
    expect(map).toMatch(/<MapGlyphPin kind="business" color=\{BUSINESS_PIN_COLOR\} \/>/);
    expect(map).not.toMatch(/pinColor=/);
  });
  test('live is still decided only by isMapLiveNow', () => {
    expect(map).toMatch(/const live = isMapLiveNow\(g\.scheduled_at\);/);
    expect(map).toMatch(/live=\{live\}/);
  });
  test('screen-reader labels unchanged and the drawn pin is hidden from them', () => {
    expect(map).toMatch(/accessibilityLabel=\{t\(live \? 'ui\.mapView\.gatheringLiveA11y' : 'ui\.mapView\.gatheringA11y'/);
    expect(map).toMatch(/accessibilityLabel=\{t\('ui\.mapView\.dealAtA11y'/);
    expect(map).toMatch(/accessibilityLabel=\{t\('ui\.mapView\.businessA11y'/);
    expect(pin).toMatch(/importantForAccessibility="no-hide-descendants"/);
    expect(pin).toMatch(/accessibilityElementsHidden/);
  });
  test('taps, callouts and stacking unchanged', () => {
    expect(map).toMatch(/stackGatheringPins\(pinnableGatherings\)\.map/);
    expect(map).toMatch(/<Callout onPress=\{\(\) => onSelectGathering\(g\)\}/);
    expect(map).toMatch(/<Callout onPress=\{\(\) => onSelectDeal\(d\)\}/);
    expect(map).toMatch(/onPress=\{\(\) => onSelectBusiness\(b, pinSpot\(/);
  });
  test('no motion, no new strings in the pin', () => {
    expect(pin).not.toMatch(/\bAnimated\b|Reanimated|LayoutAnimation/);
    expect(pin).not.toMatch(/\btr\(|\bt\(|useLanguage/);
    expect(map).not.toMatch(/\bAnimated\b/);
  });
  test('the glyph does not scale with the system font size (keeps the pin its tested size)', () => {
    expect(pin.match(/allowFontScaling=\{false\}/g)).toHaveLength(2);
  });
});
