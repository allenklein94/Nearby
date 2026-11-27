// Build 87 device test findings (owner, 2026-11-27): Messages title, Matches heading, People control icons, Friends empty states.
import fs from 'fs';
import path from 'path';
import { FUNCTIONAL_ICONS, switchToIcon } from '../constants/functionalIcons';
import { EMPTY_STATES } from '../constants/emptyStates';
import empty from '../i18n/ui/empty';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('Messages keeps its own title on both tabs', () => {
  const src = read('screens/MessagesScreen.js');
  expect(src).toContain("navigation.setOptions({ title: t('ui.nav.title.messages') })");
  expect(src).not.toContain('messagesFriends');
});

test('the Matches list (only ever inside Messages) has no second "Matches" heading', () => {
  expect(read('screens/MatchesScreen.js')).not.toContain("t('matches.title')");
});

test('a view switch shows the view it switches TO', () => {
  expect(switchToIcon('cards', ['cards', 'list'])).toBe(FUNCTIONAL_ICONS.list);
  expect(switchToIcon('list', ['cards', 'list'])).toBe(FUNCTIONAL_ICONS.cards);
  expect(switchToIcon('list', ['list', 'map'])).toBe(FUNCTIONAL_ICONS.map);
  expect(switchToIcon('map', ['list', 'map'])).toBe(FUNCTIONAL_ICONS.list);
});

test('People and Discover controls use the one icon set, never emoji', () => {
  for (const f of ['screens/DiscoveryScreen.js', 'screens/FriendDiscoveryScreen.js', 'screens/DiscoverHubScreen.js']) {
    const src = read(f);
    expect(src).not.toMatch(/'🃏'|'📋'/);
    expect(src).toContain('switchToIcon(viewStyle');
  }
  const dating = read('screens/DiscoveryScreen.js');
  expect(dating).not.toMatch(/>ⓘ<|>🗺️<|>👤</);
});

test('Friends Browse and Crossed Paths empty states differ, in every language', () => {
  expect(EMPTY_STATES.friend_crossed_paths_empty.title).not.toBe(EMPTY_STATES.friend_discovery_empty.title);
  for (const [lang, table] of Object.entries(empty)) {
    expect(table.friend_crossed_paths_empty?.title).toBeTruthy();
    expect(table.friend_crossed_paths_empty.title).not.toBe(table.friend_discovery_empty.title);
    if (lang === 'en') expect(table.friend_crossed_paths_empty.title).toBe(EMPTY_STATES.friend_crossed_paths_empty.title);
  }
  const cards = read('components/FriendDiscoverySwipeCards.js');
  expect(cards).toContain("mode === 'crossedPaths' ? 'friend_crossed_paths_empty' : 'friend_discovery_empty'");
  expect(read('screens/FriendDiscoveryScreen.js').match(/discoveryMode=\{discoveryMode\}/g)).toHaveLength(2);
  // never claims tracking is on
  expect(EMPTY_STATES.friend_crossed_paths_empty.body).toMatch(/depends on your location settings/);
});

test('an opportunity empty state shows the Nearby mark once, never with a second emoji under it', () => {
  // The opportunity variant of FadeInState draws the mark itself (Activity showed the mark AND a large 🔔).
  for (const f of ['screens/DiscoveryScreen.js', 'screens/PlansScreen.js', 'screens/MatchesScreen.js', 'screens/ActivityScreen.js',
    'screens/FriendsScreen.js', 'screens/OccasionsScreen.js', 'components/MyCommunitiesSection.js']) {
    const opener = new RegExp('<FadeInState ' + 'opportunity[^>]*>\\s*<Text style=\\{styles\\.emptyEmoji\\}>');
    expect(read(f)).not.toMatch(opener);
  }
});

describe('item 23: one way to start something', () => {
  const rd = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  test('Home has no floating Start Something button or its sheet', () => {
    const home = rd('screens/HomeScreen.js');
    expect(home).not.toMatch(/styles\.fab\b/);
    expect(home).not.toMatch(/<StartSomethingModal/);
  });
  test("Create's Gathering card (for me) opens the same activity sheet", () => {
    const hub = rd('screens/CreateHubScreen.js');
    expect(hub).toMatch(/opt\.key === 'gathering' && whoFor === 'me'[\s\S]*?setStartSheetVisible\(true\)/);
    expect(hub).toContain('<StartSomethingModal');
  });
});

describe('item 16: Dating and Friends headers share one layout', () => {
  const rd = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  test('both group their controls in headerIconsRow with the same button padding', () => {
    for (const f of ['screens/DiscoveryScreen.js', 'screens/FriendDiscoveryScreen.js']) {
      const src = rd(f);
      expect(src).toContain('<View style={styles.headerIconsRow}>');
      expect(src).toContain("headerIconsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }");
      expect(src).toContain('headerIconButton: { padding: spacing.xs }');
    }
  });
  test('Friends filter summary is translated', () => {
    const src = rd('screens/FriendDiscoveryScreen.js');
    expect(src).not.toContain("['Online']");
    expect(src).not.toMatch(/: 'All';/);
  });
});

describe('item 34: functional controls use the one outline icon set, never emoji', () => {
  const rd = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  test.each([
    ['screens/ProfileScreen.js', '⚙️'], ['screens/FriendsScreen.js', '🔍'], ['screens/ChatScreen.js', '<Text style={styles.gifButtonText}>📷'],
    ['screens/DiscoverHubScreen.js', '<Text style={styles.searchIcon}>🔍'], ['screens/DiscoverHubScreen.js', '<Text style={styles.postStoryButtonIcon}>📷'],
  ])('%s has no %s control', (f, glyph) => expect(rd(f)).not.toContain(glyph));
});

test('item 30: Activity shows the Premium upsell only when there is a locked notice to unlock', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'ActivityScreen.js'), 'utf8');
  expect(src).toContain("{!premium && items.some((i) => i.type === 'notice') && (");
});
