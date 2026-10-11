// Owner item 25 #3 (2026-10-11): a join on the host's gathering, as a moment (count roll, avatar arrival, named line).
import fs from 'fs';
import path from 'path';
import { joinedNote, attendeesNewFirst, acceptedInviteeIds, newJoinsToAnimate, arrivalDelayMs, asideMs } from './hostLiveJoins';
import { attendeeCluster, attendeeSummary } from './gatheringAttendeeDisplay';
import { attendingFigure } from './gatheringFullness';
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

test('budget: within its tier, calm', () => {
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
  expect(screen).toMatch(/attendeeCluster\(gathering, liveJoin\.ids, \{ maxFaces: CLUSTER_MAX_FACES \}\)/);
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

// Owner item 28 (2026-10-11): a new gathering coming together.
describe('item 28: "accepted your invite" only from a verified accepted invite', () => {
  test('acceptedInviteeIds keeps only accepted rows; pending/declined/expired and a failed read count for nothing', () => {
    const sent = [
      { invitee_id: 'maya', status: 'accepted' }, { invitee_id: 'sam', status: 'pending' },
      { invitee_id: 'x', status: 'declined' }, { invitee_id: 'y', status: 'expired' }, { invitee_id: null, status: 'accepted' },
    ];
    expect([...acceptedInviteeIds(sent)]).toEqual(['maya']);
    expect(acceptedInviteeIds(null).size).toBe(0);
  });
  test('the invite wording needs the accepted invite; otherwise the item-25 wording stands', () => {
    const accepted = new Set(['maya']);
    expect(joinedNote(['maya'], rows, new Set(['maya']), accepted)).toEqual({ key: 'invite', name: 'Maya', count: 1 });
    expect(joinedNote(['sam'], rows, new Set(), accepted)).toEqual({ key: 'one', name: 'Sam', count: 1 }); // joined another way
    expect(joinedNote(['maya'], rows, new Set(['maya']), new Set())).toEqual({ key: 'friend', name: 'Maya', count: 1 });
    expect(joinedNote(['maya'], rows, new Set(['maya']))).toEqual({ key: 'friend', name: 'Maya', count: 1 });
    expect(joinedNote(['sam', 'maya'], rows, new Set(), accepted).key).toBe('many');
    expect(joinedNote(['anon'], rows, new Set(), new Set(['anon']))).toBeNull(); // no name = no line, as before
  });
  test('the screen passes the host\'s own sent invitations from the same read', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/GatheringDetailScreen.js'), 'utf8');
    expect(screen).toMatch(/joinedNote\(fresh, joinRows, friendIds, acceptedInviteeIds\(invites\)\)/);
    expect(screen).toMatch(/getHostSentInvitations\(gatheringId\)\.catch\(\(\) => null\)/);
  });
  test('every language has the invite line with {name}', () => {
    for (const ns of Object.values(hostCenter)) expect(ns.joined.invite).toContain('{name}');
  });
});

describe('item 28: the avatar flows in, the others ease aside', () => {
  const motion = fs.readFileSync(path.join(__dirname, '../motion/JoinArrival.js'), 'utf8');
  test('a short slide from the leading edge, the same duration for the faces easing aside, native driver, no arc/bounce', () => {
    expect(SEQUENCES.friendJoin.flowPx).toBeGreaterThan(0);
    expect(SEQUENCES.friendJoin.flowPx).toBeLessThanOrEqual(32);
    expect(motion).toMatch(/outputRange: \[-J\.flowPx, 0\]/);
    expect(motion).toMatch(/outputRange: \[-asideBy, 0\]/);
    expect(motion.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/Animated\.spring|Easing\.bounce|Easing\.elastic|travelArc/);
    expect(motion).toMatch(/useNativeDriver: true/);
    expect(isWithinBudget(settleMs('friendJoin'), SEQUENCES.friendJoin.tier)).toBe(true);
  });
  test('only on a live join: the faces ease aside only while someone is arriving, keyed to that join', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/GatheringDetailScreen.js'), 'utf8');
    expect(screen).toMatch(/const aside = !arriving && arrivals > 0;/);
    expect(screen).toMatch(/asideBy=\{aside \? arrivals \* AVATAR_SLOT_PX : 0\}/);
    expect(screen).toMatch(/key=\{arriving \|\| aside \? `\$\{attendee\.user_id\}:\$\{joinGlowKey\}` : attendee\.user_id\}/);
  });
});

// Item 28 follow-up (owner, 2026-10-11): one after another, a cluster of the whole group, a count that includes the host.
describe('item 28 follow-up: sequential arrival', () => {
  const J = SEQUENCES.friendJoin;
  test('several people in one update arrive one after another, the lead first; late arrivals share the last slot', () => {
    expect([0, 1, 2].map(arrivalDelayMs)).toEqual([0, J.staggerMs, 2 * J.staggerMs]);
    expect(arrivalDelayMs(J.maxStaggered + 3)).toBe((J.maxStaggered - 1) * J.staggerMs);
    expect(arrivalDelayMs(-1)).toBe(0);
  });
  test('the faces already there ease aside for the whole sequence, finishing as the last arrival lands', () => {
    expect(asideMs(1)).toBe(J.avatarMs); // a single join is item 28's moment, unchanged
    expect(asideMs(3)).toBe(2 * J.staggerMs + J.avatarMs);
    expect(asideMs(0)).toBe(0);
    expect(asideMs(50)).toBeLessThanOrEqual(settleMs('friendJoin'));
    expect(isWithinBudget(settleMs('friendJoin'), J.tier)).toBe(true);
  });
  test('simultaneous joins are ONE update (one moment, "Maya and 2 more joined"); separate updates stay separate', () => {
    const base = { previousIds: new Set(['a']), previousGoing: 1, live: true, shown: new Set() };
    const three = [{ user_id: 'a', status: 'approved' }, ...['maya', 'sam', 'lee'].map((id) => ({ user_id: id, status: 'approved', profiles: { display_name: id } }))];
    const fresh = newJoinsToAnimate(three, { ...base, going: 4 });
    expect(fresh).toEqual(['maya', 'sam', 'lee']);
    expect(joinedNote(fresh, three, new Set()).key).toBe('many');
    // a later update (after the 700 ms debounce) plays only its own new person; a duplicate event plays nothing
    const shown = new Set(fresh);
    const later = newJoinsToAnimate([...three, { user_id: 'kai', status: 'approved' }], { previousIds: new Set(['a', ...fresh]), previousGoing: 4, going: 5, live: true, shown });
    expect(later).toEqual(['kai']);
    expect(newJoinsToAnimate(three, { previousIds: new Set(['a', ...fresh]), previousGoing: 4, going: 4, live: true, shown })).toEqual([]);
    const screen = fs.readFileSync(path.join(__dirname, '../screens/GatheringDetailScreen.js'), 'utf8');
    expect(screen).toMatch(/timer = setTimeout\(\(\) => \{ liveJoinReloadRef\.current = true; load\(\); \}, 700\);/);
  });
  test('the screen staggers each arrival and the faces easing aside take the whole sequence', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/GatheringDetailScreen.js'), 'utf8');
    expect(screen).toMatch(/delayMs=\{arriving \? arrivalDelayMs\(order\+\+\) : 0\}/);
    expect(screen).toMatch(/asideMs=\{asideMs\(arrivals\)\}/);
    expect(screen).toMatch(/const AVATAR_SLOT_PX = 36 - CLUSTER_OVERLAP_PX;/); // defined (it was referenced but missing)
    const motion = fs.readFileSync(path.join(__dirname, '../motion/JoinArrival.js'), 'utf8');
    expect(motion).toMatch(/duration: J\.avatarMs, delay: delayMs/);
    expect(motion).toMatch(/duration: asideMs/);
  });
  test('Reduce Motion: the settled cluster at once (the animate flag is read every render, so turning it on mid-sequence settles)', () => {
    const motion = fs.readFileSync(path.join(__dirname, '../motion/JoinArrival.js'), 'utf8');
    expect(motion).toMatch(/return \{ v, animate: play && !reduceMotion \};/);
    expect(motion).toMatch(/if \(!animate\) return <View style=\{style\}>\{children\}<\/View>;/);
  });
});

describe('item 28 follow-up: the cluster and the count', () => {
  const host = { user_id: 'host', profiles: { display_name: 'You' } };
  const guest = (id) => ({ user_id: id, status: 'approved', profiles: { display_name: id } });
  const g = (approvedAttendees, approvedCount) => ({ host_id: 'host', host: host.profiles, approvedAttendees, approvedCount });
  test('host + 3 joined = a four-person cluster and "4 attending"', () => {
    const c = attendeeCluster(g([guest('a'), guest('b'), guest('c')], 3));
    expect(c.faces.map((f) => f.user_id)).toEqual(['host', 'a', 'b', 'c']);
    expect(c.faces[0].isHost).toBe(true);
    expect(c.total).toBe(4);
    expect(c.overflow).toBe(0);
    expect(hostCenter.en.stat.going.other.replace('{count}', attendingFigure(g([], 3), 3))).toBe('4 attending');
    expect(attendeeSummary(g([guest('a'), guest('b'), guest('c')], 3)).text).toBe('4 people going');
  });
  test('people who just joined lead the cluster, so they are the faces that arrive (next to the host)', () => {
    const c = attendeeCluster(g([guest('a'), guest('b'), guest('c')], 3), ['c']);
    expect(c.faces.map((f) => f.user_id)).toEqual(['c', 'host', 'a', 'b']);
  });
  test('each person once: a duplicated row or a host row never adds a face or a count', () => {
    const c = attendeeCluster(g([guest('a'), guest('a'), { user_id: 'host', status: 'approved' }], 1));
    expect(c.faces.map((f) => f.user_id)).toEqual(['host', 'a']);
    expect(c.total).toBe(2);
  });
  test('people the viewer may not see are the "+N" count, never a face; past the face limit too', () => {
    expect(attendeeCluster(g([guest('a')], 5))).toMatchObject({ total: 6, overflow: 4 });
    const many = attendeeCluster(g(['a', 'b', 'c', 'd', 'e', 'f', 'h'].map(guest), 7));
    expect(many.faces).toHaveLength(6);
    expect(many.overflow).toBe(2);
  });
  test('nobody joined yet = no cluster (the section shows once someone joins); unknown stays unknown', () => {
    expect(attendeeCluster(g([], 0))).toBeNull();
    expect(attendingFigure(g([], 0), null)).toBeNull();
    expect(attendingFigure(g([], 0), 0)).toBe(1);
  });
  test('only attending people: Interested, requests, waitlist and invitees are never in the figure', () => {
    const src = fs.readFileSync(path.join(__dirname, './gatheringFullness.js'), 'utf8');
    const fn = src.slice(src.indexOf('export function attendingFigure'), src.indexOf('export function guestLimit'));
    expect(fn).not.toMatch(/interest|waitlist|request|invite/i);
  });
  test('the same host-inclusive figure everywhere the attending count is shown', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(read('../screens/GatheringDetailScreen.js')).toMatch(/going: attendingFigure\(g, going \?\? attendeeTotal\(g\)\)/);
    expect(read('../screens/GatheringDetailScreen.js')).toMatch(/joinPreviousGoing=\{attendingFigure\(gathering, liveJoin\.previousGoing\)\}/);
    expect(read('../screens/HomeScreen.js')).toMatch(/'reasons\.attendingCount', \{ count: attendingFigure\(g\) \}/);
    expect(read('../screens/DiscoverHubScreen.js')).toMatch(/'attendingCount', \{ count: attendingFigure\(g, attendeeCount\) \}/);
    expect(read('./discoverSections.js')).toMatch(/'attendingCount', \{ count: attendingFigure\(g, n\) \}/);
    expect(read('./homeSignalMerge.js')).toMatch(/'trendingGoing', \{ count: attendingFigure\(g, n\) \}/);
    expect(read('../services/gatherings.js')).toMatch(/'peopleAttending', \{ count: attendingFigure\(gathering, attendeeCount\) \}/);
    expect(read('../services/homeDashboard.js')).toMatch(/peopleCount: attendingFigure\(p, /);
    expect(read('../screens/PlansScreen.js')).toMatch(/attendingFigure\(item\.gathering\)/);
    // Trending still means >= 5 JOINED people (the locked threshold compares guests)
    expect(read('./discoverSections.js')).toMatch(/attendeeTotal\(g\) >= TRENDING_ATTENDANCE_MIN/);
  });
});
