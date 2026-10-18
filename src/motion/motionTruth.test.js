// Owner rule (2026-10-11, locked): motion amplifies correct data, never hides incorrect data. A moment animates only data that
// is already final and agrees with its static view; it never starts on a placeholder that swaps mid-play, never claims a
// server fact before the server said so, and never narrates progress no real stage drives. Audit:
// PRODUCT_AUDIT/MOTION_TRUTH_AUDIT_2026-10-11.md. Item 41's own guards live in utils/friendsPlanningMoment.test.js and item
// 30's ("✓ Saved" only after the save) in motion/interestedSaved.test.js.
const fs = require('fs');
const path = require('path');

const read = (r) => fs.readFileSync(path.join(__dirname, '..', r), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
});

describe('motion amplifies correct data', () => {
  test('a reply card assembles with its logo and its "heard" wording already decided (both resolved before the offers are set)', () => {
    const src = read('screens/BusinessRequestDetailScreen.js');
    const load = src.slice(src.indexOf('const load = useCallback(async () => {'));
    const offersSet = load.indexOf('setOffers(result.offers)');
    expect(load.indexOf('getScreenedLogos(logoIds)')).toBeGreaterThan(0);
    expect(load.indexOf('getScreenedLogos(logoIds)')).toBeLessThan(offersSet);
    expect(load.indexOf('if (logos) setPartnerLogos(logos)')).toBeLessThan(offersSet);
    expect(load.indexOf('setFirstReplyOfferId(first.id)')).toBeLessThan(offersSet);
    expect(src).not.toMatch(/getScreenedLogos\(logoIds\)\.then\(setPartnerLogos\)/); // the old fire-and-forget
  });

  test('a joining face is signed before it flows in on the host\'s screen', () => {
    const src = read('screens/GatheringDetailScreen.js');
    const signed = src.indexOf('const arrivingPhotos = await Promise.all(fresh.map(');
    const merged = src.indexOf('setAttendeePhotoUrls((cur) => ({ ...cur, ...Object.fromEntries(arrivingPhotos');
    const play = src.indexOf('setLiveJoin((cur) => ({ ids: fresh');
    expect(signed).toBeGreaterThan(0);
    expect(merged).toBeGreaterThan(signed);
    expect(play).toBeGreaterThan(merged);
  });

  test('"You + {Name}": the friend\'s photo is signed before the friend is set (the faces converge at mount)', () => {
    const src = read('screens/HomeScreen.js');
    const fn = src.slice(src.indexOf('const loadFriendNearby = useCallback'), src.indexOf('async function turnOffFriendNearby'));
    expect(fn.indexOf('const photo = friend?.photoPath ? await getSignedPhotoUrl')).toBeGreaterThan(0);
    expect(fn.indexOf('const photo =')).toBeLessThan(fn.indexOf('setNearbyFriend(friend)'));
    expect(fn).toMatch(/setNearbyFriend\(friend\);\s*setNearbyFriendPhoto\(photo\);/);
  });

  test('no loader cycles captions on a timer: one call = one caption', () => {
    expect(read('components/FindingOptionsLoader.js')).toMatch(/caption=\{PLANNING_CAPTIONS\[0\]\}/);
    const offenders = walk(path.join(__dirname, '..'))
      .filter((f) => /captions=\{/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(path.join(__dirname, '..'), f));
    expect(offenders).toEqual([]); // a new staged loader needs real stages driving it, never a timer
    // Idea "175" (owner, 2026-10-18): NLoader itself has no caption timer to bring back.
    const loader = read('motion/NLoader.js');
    expect(loader).not.toMatch(/\bcaptions\b/);
    expect(loader).not.toMatch(/setInterval\(|CAPTION_STEP_MS/);
  });
});
