// Owner item 25 #3 (2026-10-11): a join on the host's gathering, as a moment (count roll, avatar arrival, named line).
import fs from 'fs';
import path from 'path';
import { joinedNote, attendeesNewFirst } from './hostLiveJoins';
import { SEQUENCES, settleMs, isWithinBudget } from '../motion/motionBudget';
import hostCenter from '../i18n/ui/hostCenter';

const rows = [
  { user_id: 'maya', status: 'approved', profiles: { display_name: 'Maya' } },
  { user_id: 'sam', status: 'approved', profiles: { display_name: 'Sam' } },
  { user_id: 'anon', status: 'approved', profiles: { display_name: '  ' } },
];

describe('joinedNote', () => {
  test('one person: named; a friend of the host is "your friend"', () => {
    expect(joinedNote(['sam'], rows, new Set())).toEqual({ key: 'one', name: 'Sam', count: 1 });
    expect(joinedNote(['maya'], rows, new Set(['maya']))).toEqual({ key: 'friend', name: 'Maya', count: 1 });
  });
  test('several: a friend is named first, the rest are a count', () => {
    expect(joinedNote(['sam', 'maya'], rows, new Set(['maya']))).toEqual({ key: 'many', name: 'Maya', count: 1 });
    expect(joinedNote(['sam', 'maya', 'anon'], rows, new Set())).toEqual({ key: 'many', name: 'Sam', count: 2 });
  });
  test('nobody nameable, or nobody new: no line (never "Someone joined", never invented)', () => {
    expect(joinedNote(['anon'], rows, new Set())).toBeNull();
    expect(joinedNote(['ghost'], rows, new Set())).toBeNull();
    expect(joinedNote([], rows, new Set())).toBeNull();
    expect(joinedNote(null, rows)).toBeNull();
  });
});

test('the new face goes to the front of Who\'s going; nothing new = the row unchanged', () => {
  const list = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'maya' }];
  expect(attendeesNewFirst(list, ['maya']).map((x) => x.user_id)).toEqual(['maya', 'a', 'b']);
  expect(attendeesNewFirst(list, [])).toBe(list);
  expect(attendeesNewFirst(null, ['maya'])).toEqual([]);
});

test('budget: medium tier, calm', () => {
  expect(isWithinBudget(settleMs('friendJoin'), SEQUENCES.friendJoin.tier)).toBe(true);
  const src = fs.readFileSync(path.join(__dirname, '../motion/JoinArrival.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect(code).not.toMatch(/Animated\.spring|Animated\.loop|playHaptic|expo-haptics|confetti|particle/i);
  expect(code).toMatch(/useReduceMotion/);
  expect(code).toMatch(/infoOpacity\(v\)/);
  expect(code).not.toMatch(/useNativeDriver: false/);
});

test('plays only for the locked item-15 live joins, and the count never waits on the friends lookup', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../screens/GatheringDetailScreen.js'), 'utf8');
  const i = screen.indexOf('if (fresh.length > 0) {');
  const block = screen.slice(i, i + 1200);
  expect(block).toMatch(/setLiveJoin\(\{ ids: fresh, previousGoing: goingBefore, note: null \}\);/);
  expect(block).not.toMatch(/await filterToMyFriends/);
  expect(screen).toMatch(/attendeesNewFirst\(gathering\.approvedAttendees, liveJoin\.ids\)/);
  const center = fs.readFileSync(path.join(__dirname, '../components/HostCommandCenter.js'), 'utf8');
  expect(center).toMatch(/<CountRoll\s+key=\{`roll:\$\{joinGlowKey\}`\}/);
  expect(center).toMatch(/joinGlowKey > 0 && joinedNote \?/);
  // item 15's glow is kept
  expect(center).toMatch(/<OfferProgressGlow key=\{joinGlowKey\} play color=\{colors\.success\}/);
});

test('every language has the three joined lines with their placeholders', () => {
  for (const [lang, ns] of Object.entries(hostCenter)) {
    expect(ns.joined.one).toContain('{name}');
    expect(ns.joined.friend).toContain('{name}');
    expect(ns.joined.many.other).toContain('{count}');
    expect(ns.joined.many.one).toContain('{name}');
    expect(lang).toBeTruthy();
  }
});
