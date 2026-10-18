// Owner item 40 (2026-10-11): "You + {Name} might like this". The rule (utils/friendCollision.js), the once-per-session play,
// the motion budget, and the guards that keep it an explanation built only on item 39's server-decided friend.
const fs = require('fs');
const path = require('path');
import { friendCollision, takeCollisionPlay } from './friendCollision';
import { SEQUENCES, settleMs, tierOf } from '../motion/motionBudget';

const read = (r) => fs.readFileSync(path.join(__dirname, '..', r), 'utf8');
const friend = { id: 'f1', name: 'Claude', photoPath: 'p/1.jpg', sharedTags: ['Pickleball'] };
const g = (over = {}) => ({ id: 'g1', interest_tag: 'Pickleball', host_id: 'h1', approvedAttendees: [], ...over });
const base = { friend, myUserId: 'me', myDeclaredInterests: ['Pickleball', 'Coffee'] };

describe('the rule', () => {
  test('a nearby friend + an interest you both declared + a gathering of it -> that card, with the friend', () => {
    expect(friendCollision({ ...base, gatherings: [g()] })).toEqual({ gatheringId: 'g1', tag: 'Pickleball', friend: { id: 'f1', name: 'Claude', photoPath: 'p/1.jpg' } });
  });
  test('the first qualifying card in display order only (once per Home)', () => {
    const r = friendCollision({ ...base, gatherings: [g({ id: 'a', interest_tag: 'Yoga' }), g({ id: 'b' }), g({ id: 'c' })] });
    expect(r.gatheringId).toBe('b');
  });
  test('no friend, no name, no shared tags, or no matching gathering -> nothing', () => {
    expect(friendCollision({ ...base, friend: null, gatherings: [g()] })).toBeNull();
    expect(friendCollision({ ...base, friend: { ...friend, name: '' }, gatherings: [g()] })).toBeNull();
    expect(friendCollision({ ...base, friend: { ...friend, sharedTags: [] }, gatherings: [g()] })).toBeNull();
    expect(friendCollision({ ...base, friend: { ...friend, sharedTags: undefined }, gatherings: [g()] })).toBeNull();
    expect(friendCollision({ ...base, gatherings: [g({ interest_tag: 'Yoga' })] })).toBeNull();
  });
  test('the viewer must have declared it too (checked on the client again; a stale server tag never qualifies)', () => {
    expect(friendCollision({ ...base, myDeclaredInterests: ['Coffee'], gatherings: [g()] })).toBeNull();
    expect(friendCollision({ ...base, myDeclaredInterests: undefined, gatherings: [g()] })).toBeNull();
  });
  test('never on your own or the friend\'s gathering, or one either of you already attends', () => {
    expect(friendCollision({ ...base, gatherings: [g({ host_id: 'f1' })] })).toBeNull();
    expect(friendCollision({ ...base, gatherings: [g({ host_id: 'me' })] })).toBeNull();
    expect(friendCollision({ ...base, gatherings: [g({ approvedAttendees: [{ user_id: 'f1' }] })] })).toBeNull();
    expect(friendCollision({ ...base, gatherings: [g({ approvedAttendees: [{ user_id: 'me' }] })] })).toBeNull();
    expect(friendCollision({ ...base, gatherings: [g({ host_id: 'f1' }), g({ id: 'g2' })] }).gatheringId).toBe('g2');
  });
});

describe('the moment', () => {
  test('plays once per (friend, gathering) per session', () => {
    const store = new Set();
    const c = { gatheringId: 'g1', friend: { id: 'f1' } };
    expect(takeCollisionPlay(c, store)).toBe(true);
    expect(takeCollisionPlay(c, store)).toBe(false);
    expect(takeCollisionPlay({ ...c, gatheringId: 'g2' }, store)).toBe(true);
    expect(takeCollisionPlay(null, store)).toBe(false);
  });
  test('medium tier, well under half a second', () => {
    expect(SEQUENCES.friendCollision.tier).toBe('medium');
    expect(settleMs('friendCollision')).toBeLessThanOrEqual(500);
    expect(tierOf(settleMs('friendCollision'))).toBe('medium');
  });
  test('text readable from the first frame, no touches, native driver, no haptic, Reduce Motion settles', () => {
    const src = read('motion/FriendCollision.js');
    expect(src).toMatch(/infoOpacity\(text\)/);
    expect(src).toMatch(/pointerEvents="none"/);
    expect(src).not.toMatch(/useNativeDriver: false/);
    expect(src).not.toMatch(/playHaptic|haptics/);
    expect(src).toMatch(/!reduceMotion/);
  });
});

describe('guards', () => {
  test('Home is the only surface, and it decides only through the one rule', () => {
    const SRC = path.join(__dirname, '..');
    const walk = (d, out = []) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const users = walk(SRC).filter((f) => /FriendCollision|friendCollision\(|ui\.friendNearby\.together/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort();
    // constants/motionLanguage.js only documents the trigger (item 162, read by no component)
    expect(users).toEqual(['constants/motionLanguage.js', 'motion/FriendCollision.js', 'motion/index.js', 'motion/motionBudget.js', 'screens/HomeScreen.js', 'utils/friendCollision.js']);
  });
  test('it explains, never ranks: no ranking code reads it, and it never says the friend is going', () => {
    for (const f of ['utils/homeAttention.js', 'utils/homeSignalMerge.js', 'constants/signalPriority.js', 'services/homeDashboard.js']) {
      expect([f, /friendCollision|sharedTags/.test(read(f))]).toEqual([f, false]);
    }
    const ns = require('../i18n/ui/friendNearby').default;
    expect(ns.en.together).toBe('You + {name} might like this');
    for (const lang of Object.keys(ns)) {
      expect(ns[lang].together).toMatch(/\{name\}/);
      expect(ns[lang].togetherA11y).toMatch(/\{name\}/);
    }
    expect(ns.en.together).not.toMatch(/going|attending|there|strong match|perfect/i);
  });
});
