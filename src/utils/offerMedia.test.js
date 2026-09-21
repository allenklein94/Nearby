const fs = require('fs');
const path = require('path');
const { videoFrameTimes, videoLimitProblem, visibleRedemption, MAX_OFFER_VIDEO_BYTES, validUntilFromChoice, validityLabel, isOfferExpired } = require('./offerMedia');
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
  expect(fn).toMatch(/if \(m\.service\) return (screeningUnavailable\(\)|UNAVAILABLE)/);
  expect(fn).toMatch(/\(!mediaPath \|\| creativeRow\) && !redemptionInstructions/); // owner-typed instructions are never fast-pathed
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

test('validity: owner-picked day + time becomes a real future timestamp; a past time is refused, none means no end time', () => {
  const now = new Date(2026, 8, 20, 15, 0);
  const at = (h, m = 0) => new Date(2026, 8, 20, h, m);
  expect(validUntilFromChoice(null, null, now)).toEqual({ iso: null });
  expect(validUntilFromChoice('today', at(19), now).iso).toBe(new Date(2026, 8, 20, 19, 0).toISOString());
  expect(validUntilFromChoice('tomorrow', at(9), now).iso).toBe(new Date(2026, 8, 21, 9, 0).toISOString());
  expect(validUntilFromChoice('today', at(14), now).error).toMatch(/later than now/);
  expect(validUntilFromChoice('today', null, now).error).toMatch(/Pick the time/);
});
test('validity label reads "Valid until 7 PM", flags expired, and is null with no end time', () => {
  const now = new Date(2026, 8, 20, 15, 0);
  expect(validityLabel(null, now)).toBeNull();
  expect(validityLabel(new Date(2026, 8, 20, 19, 0).toISOString(), now)).toBe('Valid until 7 PM');
  expect(validityLabel(new Date(2026, 8, 20, 14, 0).toISOString(), now)).toBe('expired');
  expect(isOfferExpired({ valid_until: new Date(2026, 8, 20, 14, 0).toISOString() }, now)).toBe(true);
  expect(isOfferExpired({}, now)).toBe(false);
});
test('creative library + validity are enforced in the database, and the library is owner-read only', () => {
  const sql = read('supabase/migrations/20270136_creative_library_offer_validity.sql');
  expect(sql).toMatch(/create policy "Owners read their creatives"/);
  expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*business_creatives/i);
  expect(sql).toMatch(/This offer has expired\./);
  expect(sql).toMatch(/v_offer\.valid_until <= now\(\)/);
  expect(sql).toMatch(/That saved creative is not available/);
  const fn = read('supabase/functions/screen-business-content/index.ts');
  expect(fn).toMatch(/reused without re-screening/);
  expect(fn).toMatch(/if \(m\.tier === 'low'\)/); // only cleanly-screened media is saved for reuse
});

describe('available window', () => {
  const { availableWindowFromChoice, availableWindowLabel } = require('./offerMedia');
  const t = (h, m = 0) => new Date(2026, 8, 20, h, m);
  it('needs both ends or neither, and the end after the start', () => {
    expect(availableWindowFromChoice(null, null)).toEqual({ from: null, until: null });
    expect(availableWindowFromChoice(t(18), null).error).toBeTruthy();
    expect(availableWindowFromChoice(t(20), t(18)).error).toBeTruthy();
    expect(availableWindowFromChoice(t(18), t(20))).toEqual({ from: '18:00', until: '20:00' });
  });
  it('labels a real window only', () => {
    expect(availableWindowLabel('18:00:00', '20:00:00')).toBe('Available 6–8 PM');
    expect(availableWindowLabel('11:30:00', '13:00:00')).toBe('Available 11:30 AM–1 PM');
    expect(availableWindowLabel('18:00:00', null)).toBeNull();
    expect(availableWindowLabel(null, null)).toBeNull();
  });
  it('is carried by the edge function, the service and the review path', () => {
    const fs = require('fs');
    const path = require('path');
    const edge = fs.readFileSync(path.join(__dirname, '../../supabase/functions/screen-business-content/index.ts'), 'utf8');
    expect(edge).toMatch(/available_from_param: availableFrom/);
    expect(edge).toMatch(/validUntil, availableFrom, availableUntil \}/);
    const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270152_offer_available_window.sql'), 'utf8');
    expect(mig).toMatch(/content_snapshot->>'availableFrom'/);
  });
});
