const fs = require('fs');
const path = require('path');
const { videoFrameTimes, videoLimitProblem, visibleRedemption, MAX_OFFER_VIDEO_BYTES } = require('./offerMedia');
const { settleMs, isWithinBudget, SEQUENCES } = require('../motion/motionBudget');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

test('frame sampling: start/middle/end for a normal clip, fewer for short or unknown ones', () => {
  expect(videoFrameTimes(20000)).toEqual([0, 10000, 19500]);
  expect(videoFrameTimes(1000)).toEqual([0]);
  expect(videoFrameTimes(undefined)).toEqual([0]);
});
test('video limits: 30s and 25MB, images and unknown sizes pass', () => {
  expect(videoLimitProblem({ type: 'video', duration: 31000 })).toMatch(/30 seconds/);
  expect(videoLimitProblem({ type: 'video', fileSize: MAX_OFFER_VIDEO_BYTES + 1 })).toMatch(/25MB/);
  expect(videoLimitProblem({ type: 'video', duration: 20000, fileSize: 1000 })).toBeNull();
  expect(videoLimitProblem({ type: 'image', fileSize: 999999999 })).toBeNull();
});
test('redemption instructions are shown only once the offer is the customer\'s', () => {
  const o = { redemption_instructions: ' Show this at the counter ' };
  expect(visibleRedemption({ ...o, status: 'offered' })).toBeNull();
  expect(visibleRedemption({ ...o, status: 'accepted' })).toBe('Show this at the counter');
  expect(visibleRedemption({ redemption_instructions: '  ', status: 'accepted' })).toBeNull();
});
test('the offer reveal sits inside the medium motion tier and is arrival-driven (no haptic)', () => {
  expect(isWithinBudget(settleMs('offerReveal'), SEQUENCES.offerReveal.tier)).toBe(true);
  expect(read('src/components/OfferReveal.js')).not.toMatch(/expo-haptics|playHaptic/);
  expect(read('src/components/OfferReveal.js')).toMatch(/useReduceMotion/);
});
test('the server screens media before a customer sees it and refuses a video without frames', () => {
  const fn = read('supabase/functions/screen-business-content/index.ts');
  expect(fn).toMatch(/screenOfferMedia\(admin, partnerId, mediaPath/);
  expect(fn).toMatch(/A video needs preview images/);
  expect(fn).toMatch(/MAX_OFFER_VIDEO_BYTES/);
  expect(fn).toMatch(/if \(m\.service\) return screeningUnavailable\(\)/);
  expect(fn).toMatch(/!mediaPath && !redemptionInstructions/); // owner-typed instructions are never fast-pathed
  const sql = read('supabase/migrations/20270134_rich_offer_media_redemption.sql');
  expect(sql).toMatch(/A video needs a preview image/);
  expect(sql).toMatch(/drop function if exists public\.submit_business_offer/);
  expect(read('supabase/migrations/20270135_review_rich_offer_media.sql')).toMatch(/media_poster_path/);
});
test('a video only plays when it has a screened poster; it never autoplays with sound', () => {
  const c = read('src/components/OfferMedia.js');
  expect(c).toMatch(/if \(!posterPath\)/);
  expect(c).toMatch(/isMuted/);
  expect(c).toMatch(/onPress=\{\(\) => setPlaying\(true\)\}/);
});
