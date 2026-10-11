import { uploadResize, OFFER_IMAGE_MAX_PX, LOGO_MAX_PX } from './mediaBudget';

// Owner item 22: a photo is shrunk on the phone before upload; never upscaled; unknown size left alone.
test('a 12 MP landscape photo shrinks to 1600 px wide', () => {
  expect(uploadResize(4032, 3024)).toEqual({ width: OFFER_IMAGE_MAX_PX });
});

test('a portrait photo is bounded on its long (height) side', () => {
  expect(uploadResize(3024, 4032)).toEqual({ height: OFFER_IMAGE_MAX_PX });
});

test('a photo that already fits is uploaded as is (never upscaled)', () => {
  expect(uploadResize(1600, 900)).toBeNull();
  expect(uploadResize(800, 600)).toBeNull();
});

test('unknown or nonsense dimensions are left as is', () => {
  expect(uploadResize(undefined, 1000)).toBeNull();
  expect(uploadResize(0, 0)).toBeNull();
  expect(uploadResize(NaN, 5000)).toBeNull();
  expect(uploadResize(Infinity, 5000)).toBeNull();
});

test('logos have their own, smaller bound', () => {
  expect(uploadResize(2000, 2000, LOGO_MAX_PX)).toEqual({ width: LOGO_MAX_PX });
  expect(uploadResize(400, 400, LOGO_MAX_PX)).toBeNull();
});

describe('createSignedUrlCache (item 22: one address per photo, so the image cache works)', () => {
  const { createSignedUrlCache, SIGNED_URL_REUSE_MS } = require('./mediaBudget');

  test('the same path reuses its address while it has life left, then asks again', async () => {
    let t = 0;
    let n = 0;
    const cached = createSignedUrlCache({ now: () => t });
    const fetchUrl = async (p) => `https://x/${p}?token=${++n}`;
    const a = await cached('o/1.jpg', fetchUrl);
    t += SIGNED_URL_REUSE_MS - 1;
    expect(await cached('o/1.jpg', fetchUrl)).toBe(a);
    t += 1;
    expect(await cached('o/1.jpg', fetchUrl)).not.toBe(a);
    expect(n).toBe(2);
  });

  test('concurrent asks share one request', async () => {
    let n = 0;
    const cached = createSignedUrlCache();
    const fetchUrl = async (p) => { n += 1; return `u/${p}`; };
    const [a, b] = await Promise.all([cached('p', fetchUrl), cached('p', fetchUrl)]);
    expect(a).toBe(b);
    expect(n).toBe(1);
  });

  test('a failure is never cached, and no path = no request', async () => {
    let n = 0;
    const cached = createSignedUrlCache();
    expect(await cached('p', async () => { n += 1; return null; })).toBeNull();
    expect(await cached('p', async () => { n += 1; throw new Error('x'); })).toBeNull();
    expect(await cached('p', async () => { n += 1; return 'ok'; })).toBe('ok');
    expect(n).toBe(3);
    expect(await cached(null, async () => { n += 1; return 'no'; })).toBeNull();
    expect(n).toBe(3);
  });
});
