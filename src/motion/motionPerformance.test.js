// Owner item 22 (2026-10-11): strict performance rules for motion and offer media on a real phone. Source guard, like
// animationNeverDelays / animationInterruptible: the rules are mechanical, so a new file that breaks one fails here.
//   smooth on older phones  -> transform/opacity run on the native driver; a JS-driven animation needs a reason below
//   avoid huge downloads    -> photos shrink on the phone before upload; video is never transcoded, preloaded or autoplayed
//   preload intelligently   -> one signed address per file (image cache hits); nothing prefetches lists; video only on tap
//   reduced motion          -> every motion piece has a reduced path (the settled, static version)
//   never block interaction -> item 20 (animationInterruptible.test.js)
//   static fallbacks        -> loaders hold a static state under Reduce Motion and after the loop cap
//   battery                 -> loops only in ambient loaders; every loop capped + paused in the background (governLoop)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'journeys' && e.name !== '__mocks__') walk(p, out); }
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');

// Each entry is a file allowed to drive an animation on the JS thread, and why (layout props or a PanResponder gesture,
// neither of which the native driver supports). Keep it short; prefer transform/opacity on the native driver.
const JS_DRIVER_ALLOWED = {
  'motion/BookedCelebration.js': 'the exit collapses the height the card took (layout)',
  'motion/OfferTravelOverlay.js': 'the frame grows by left/top/width/height (layout); the dim is native',
  'components/SwipeableDiscoveryCards.js': 'PanResponder Animated.event cannot use the native driver',
  'components/FriendDiscoverySwipeCards.js': 'PanResponder Animated.event cannot use the native driver',
  'components/PhotoLightbox.js': 'PanResponder Animated.event cannot use the native driver',
  'components/StoryViewerModal.js': 'the story progress bar animates width (layout)',
};

// The only files that may run a perpetual loop: ambient loading, which governLoop caps and pauses.
const LOOP_ALLOWED = ['motion/NLoader.js', 'components/SkeletonCard.js', 'components/SkeletonGridCard.js'];

test('a JS-driven animation is allowed only where the native driver cannot do it', () => {
  const offenders = files.map(rel).filter((r) => /useNativeDriver:\s*false/.test(read(r)) && !JS_DRIVER_ALLOWED[r]);
  expect(offenders).toEqual([]);
  // and the allow-list never goes stale
  for (const r of Object.keys(JS_DRIVER_ALLOWED)) expect(/useNativeDriver:\s*false/.test(read(r))).toBe(true);
});

test('perpetual loops exist only in the ambient loaders, and run on the native driver', () => {
  const loopers = files.map(rel).filter((r) => /Animated\.loop\(/.test(read(r)));
  expect(loopers.sort()).toEqual([...LOOP_ALLOWED].sort());
  for (const r of LOOP_ALLOWED) expect(/useNativeDriver:\s*false/.test(read(r))).toBe(false);
  expect(files.map(rel).filter((r) => /withRepeat\(|requestAnimationFrame\(\s*function loop/.test(read(r)))).toEqual([]);
});

test('every Animated.loop is governed (capped + paused in the background) by the installed policy', () => {
  const policy = read('motion/motionPolicy.js');
  expect(policy).toMatch(/return governLoop\(originalLoop\(animation, config\)\)/);
  expect(policy).toMatch(/AppState\?\.addEventListener\?\.\('change'/);
  const { AMBIENT } = require('./motionBudget');
  expect(AMBIENT.maxLoopMs).toBeGreaterThan(0);
  expect(AMBIENT.maxLoopMs).toBeLessThanOrEqual(30000);
  expect(fs.readFileSync(path.join(SRC, '..', 'App.js'), 'utf8')).toMatch(/installReducedMotionPolicy\(Animated\)/);
});

test('every motion piece has a reduced-motion path (its own, or a shared helper that has one)', () => {
  const COVERED_HELPERS = /useKeyChangeFade|offerTravel'|startOfferTravel|subscribeOfferTravel/;
  const motion = files.map(rel).filter((r) => r.startsWith('motion/') && /Animated\.(timing|spring|loop|sequence|parallel|View|Text)/.test(read(r)));
  const missing = motion.filter((r) => !/useReduceMotion|getReduceMotion|reduceMotion/.test(read(r)) && !COVERED_HELPERS.test(read(r)));
  expect(missing).toEqual([]);
  expect(read('motion/useKeyChangeFade.js')).toMatch(/useReduceMotion|getReduceMotion|reduceMotion/);
  expect(read('motion/offerTravel.js')).toMatch(/if \(reduceMotion/);
});

test('offer video: never autoplays, never loops, mounts only after the tap', () => {
  const src = read('components/OfferMedia.js');
  expect(src).not.toMatch(/isLooping/);
  // the only shouldPlay is inside the branch reached by tapping play
  const idx = src.indexOf('shouldPlay');
  expect(idx).toBeGreaterThan(-1);
  expect(src.indexOf('shouldPlay', idx + 1)).toBe(-1);
  expect(src.lastIndexOf('if (playing && url)', idx)).toBeGreaterThan(-1);
  expect(src).toMatch(/onPress=\{\(\) => setPlaying\(true\)\}/);
  expect(src).not.toMatch(/Image\.prefetch/);
});

test('offer photos and logos shrink on the phone before upload; signed addresses are reused', () => {
  const svc = read('services/businessFulfillment.js');
  expect(svc).toMatch(/export async function uploadBusinessOfferMedia\(partnerId, pickedAsset, kind\) \{\n\s*const asset = await shrinkImageForUpload\(pickedAsset\);/);
  expect(svc).toMatch(/shrinkImageForUpload\(pickedAsset, \{ maxPx: LOGO_MAX_PX, keepPng: true \}\)/);
  expect(svc).toMatch(/const signedOfferMediaUrl = createSignedUrlCache\(\);/);
  expect(svc).not.toMatch(/createSignedUrl\([^)]*,\s*3600\)/);
});
