import fs from 'fs';
import path from 'path';
import { mediaFitMode, aspectOf, LOGO_FIT, COVER_TOLERANCE, logoBox } from './mediaFit';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('mediaFitMode (item 10: Nearby formats what the business already has)', () => {
  const FW = 343; const FH = 180; // a phone-width offer frame

  test('a landscape photo shaped like the frame fills it', () => {
    expect(mediaFitMode(1920, 1080, FW, FH)).toBe('cover');
  });
  test('a portrait flyer is shown whole, never cropped', () => {
    expect(mediaFitMode(1080, 1350, FW, FH)).toBe('contain');
  });
  test('a square graphic is shown whole', () => {
    expect(mediaFitMode(1080, 1080, FW, FH)).toBe('contain');
  });
  test("a phone video's 9:16 poster is shown whole", () => {
    expect(mediaFitMode(1080, 1920, FW, FH)).toBe('contain');
  });
  test('a very wide banner is shown whole', () => {
    expect(mediaFitMode(3000, 600, FW, FH)).toBe('contain');
  });
  test('unknown sizes never crop', () => {
    expect(mediaFitMode(null, 100, FW, FH)).toBe('contain');
    expect(mediaFitMode(100, 100, 0, FH)).toBe('contain');
    expect(aspectOf(NaN, 3)).toBeNull();
  });
  test('the tolerance boundary is inclusive', () => {
    const frame = FW / FH;
    expect(mediaFitMode(frame * COVER_TOLERANCE * 100, 100, FW, FH)).toBe('cover');
    expect(mediaFitMode(frame * (COVER_TOLERANCE + 0.05) * 100, 100, FW, FH)).toBe('contain');
  });
});

describe('logoBox (a logo never crosses its circle)', () => {
  const inside = ({ width, height }, d) => Math.hypot(width / 2, height / 2) <= d / 2 + 1e-9;
  test.each([[600, 150], [300, 300], [150, 600], [1000, 100]])('%ix%i fits inside the circle', (w, h) => {
    expect(inside(logoBox(w, h, 32), 32)).toBe(true);
  });
  test('a wide wordmark keeps most of the width', () => {
    expect(logoBox(600, 150, 32).width).toBeGreaterThan(31);
  });
  test('unknown shape falls back to the safe square box', () => {
    const b = logoBox(null, null, 32);
    expect(b.width).toBeCloseTo(b.height);
    expect(inside(b, 32)).toBe(true);
  });
});

describe('wiring', () => {
  test('offer media decides its fit through the one helper and never hard-codes a crop on business media', () => {
    const src = read('components/OfferMedia.js');
    expect(src).toMatch(/mediaFitMode/);
    // The only fixed crop allowed is the blurred backdrop behind a whole image.
    const crops = src.split('\n').filter((l) => l.includes('resizeMode="cover"'));
    expect(crops.every((l) => l.includes('blurRadius'))).toBe(true);
  });
  test('a still image that fails to load leaves nothing, not an empty box', () => {
    const src = read('components/OfferMedia.js');
    expect(src).toMatch(/onError=\{onFail\}/);
    expect(src).toMatch(/failed \? null/);
  });
  test('the blurred backdrop overhangs the frame (no halo at the edges)', () => {
    expect(read('components/OfferMedia.js')).toMatch(/BLUR_OVERHANG/);
  });
  test('a logo is always shown whole', () => {
    expect(LOGO_FIT).toBe('contain');
    const src = read('components/BusinessLogoMark.js');
    expect(src).toMatch(/LOGO_FIT/);
    expect(src).toMatch(/logoBox/);
  });
});
