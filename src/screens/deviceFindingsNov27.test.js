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
  // FadeInState opportunity draws the mark itself (Activity showed the mark AND a large 🔔).
  for (const f of ['screens/DiscoveryScreen.js', 'screens/PlansScreen.js', 'screens/MatchesScreen.js', 'screens/ActivityScreen.js',
    'screens/FriendsScreen.js', 'screens/OccasionsScreen.js', 'components/MyCommunitiesSection.js']) {
    expect(read(f)).not.toMatch(/<FadeInState opportunity[^>]*>\s*<Text style=\{styles\.emptyEmoji\}>/);
  }
});
