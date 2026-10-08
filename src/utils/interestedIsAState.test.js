// Item 38 (owner, 2026-10-08): Interested is a STATE on the gathering, never its own destination. The person changes it
// in place (Home cards, GatheringDetail: Interested -> I'm going), and its collection is Plans > Upcoming (role label
// Interested, one row per gathering, item 24), surfaced from Home's Your Plans and a Profile count.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('no Interested screen or route exists', () => {
  const { SCREEN_REGISTRY } = require('../constants/screenRegistry');
  expect(Object.keys(SCREEN_REGISTRY).filter((k) => /interest/i.test(k))).toEqual([]);
  expect(fs.readdirSync(path.join(__dirname, '../screens')).filter((f) => /interest/i.test(f))).toEqual([]);
});

test('the state changes in place, through the one writer', () => {
  expect(read('screens/GatheringDetailScreen.js')).toMatch(/setGatheringInterested/);
  expect(read('screens/HomeScreen.js')).toMatch(/setGatheringInterested/);
});

test('the collection is Plans > Upcoming; Profile shows a count that opens it, only when there is one', () => {
  expect(read('screens/PlansScreen.js')).toMatch(/interestedList\.map\(\(g\) => \(\{ gathering: g, status: 'maybe' \}\)\)/);
  const profile = read('screens/ProfileScreen.js');
  expect(profile).toMatch(/quickStats\.interested > 0 && \(\s*<TouchableOpacity[\s\S]{0,120}navigation\.navigate\('Plans', \{ initialTab: 'upcoming' \}\)/);
  expect(read('services/homeDashboard.js')).toMatch(/from\('gathering_interested'\)[^\n]*count: 'exact', head: true[^\n]*\.eq\('user_id', myId\)/);
});
