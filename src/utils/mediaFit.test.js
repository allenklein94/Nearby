import fs from 'fs';
import path from 'path';
import { OFFER_MEDIA_FIT, aspectOf, LOGO_FIT, logoBox } from './mediaFit';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('offer media fit (item 10; idea "191": every image whole, never cropped)', () => {
  test('one fit for every shape: contain', () => {
    expect(OFFER_MEDIA_FIT).toBe('contain');
  });
  test('the near-frame "cover" case is retired', () => {
    const mod = require('./mediaFit');
    expect(mod.mediaFitMode).toBeUndefined();
    expect(mod.COVER_TOLERANCE).toBeUndefined();
  });
  test('aspectOf rejects unknown sizes', () => {
    expect(aspectOf(NaN, 3)).toBeNull();
    expect(aspectOf(1920, 1080)).toBeCloseTo(16 / 9);
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
  test('offer media takes its fit from the one constant and never crops business media', () => {
    const src = read('components/OfferMedia.js');
    expect(src).toMatch(/resizeMode=\{OFFER_MEDIA_FIT\}/);
    // The only fixed crop allowed is the blurred backdrop behind a whole image.
    const crops = src.split('\n').filter((l) => l.includes('resizeMode="cover"'));
    expect(crops.every((l) => l.includes('blurRadius'))).toBe(true);
    expect(src).not.toMatch(/resizeMode=\{mode\}|ResizeMode\.COVER/);
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
