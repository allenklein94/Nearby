// Owner idea 156 (2026-10-17): swiping is a choice, never a requirement for meeting friends. Friends discovery opens as
// a list; the deck is optional; every decision is a labelled Pass / Connect, never a bare symbol.
import fs from 'fs';
import path from 'path';
import friends from '../i18n/ui/friends';
import settings from '../i18n/ui/settings';
import { friendViewStyle, otherFriendViewStyle, undecidedCandidates, FRIEND_DECISIONS, FRIEND_VIEW_STYLES } from './friendDiscoveryView';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const key = (k) => k.replace(/^ui\.friends\./, '');

describe('friendViewStyle: the list unless the person chose cards', () => {
  it('only an explicit cards is the deck', () => {
    expect(friendViewStyle('cards')).toBe('cards');
    for (const v of ['list', null, undefined, '', 'swipe', 'Cards']) expect(friendViewStyle(v)).toBe('list');
    expect(FRIEND_VIEW_STYLES).toEqual(['list', 'cards']);
  });
  it('switching goes both ways', () => {
    expect(otherFriendViewStyle('list')).toBe('cards');
    expect(otherFriendViewStyle('cards')).toBe('list');
    expect(otherFriendViewStyle(null)).toBe('cards');
  });
});

describe('undecidedCandidates: one decided set for both modes', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('drops decided people, keeps order, and a person taken back out returns', () => {
    expect(undecidedCandidates(rows, new Set())).toBe(rows);
    expect(undecidedCandidates(rows, new Set(['b'])).map((r) => r.id)).toEqual(['a', 'c']);
    const decided = new Set(['a', 'b']);
    decided.delete('a');
    expect(undecidedCandidates(rows, decided).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('Pass / Connect are labelled in every language', () => {
  it('the two decisions map to the server\'s directions', () => {
    expect(FRIEND_DECISIONS.pass.direction).toBe('pass');
    expect(FRIEND_DECISIONS.connect.direction).toBe('like');
  });
  it('each label and screen-reader label is real words in all 11 languages', () => {
    for (const lang of LANGS) {
      for (const d of Object.values(FRIEND_DECISIONS)) {
        const label = friends[lang][key(d.labelKey)];
        expect(typeof label).toBe('string');
        expect(label).toMatch(/\p{L}/u);
        expect(friends[lang][key(d.a11yKey)]).toContain('{name}');
      }
      expect(friends[lang].meetNewPeopleIntro).toMatch(/\p{L}/u);
      expect(settings[lang].friendsDisplayStyle).toMatch(/\p{L}/u);
      expect(settings[lang].chooseHowFriendsAreShown).toMatch(/\p{L}/u);
    }
  });
  it('no Friends text tells people to swipe', () => {
    const en = JSON.stringify(friends.en).toLowerCase();
    expect(en).not.toMatch(/swipe|your deck/);
    for (const gone of ['swipeToMeetNewPeople', 'like', 'pass', 'likeAsAPotentialFriendA11y']) {
      for (const lang of LANGS) expect(friends[lang][gone]).toBeUndefined();
    }
  });
});

describe('guards: list first, deck optional, no bare-symbol decisions', () => {
  const screen = read('screens/FriendDiscoveryScreen.js');
  const deck = read('components/FriendDiscoverySwipeCards.js');
  const list = read('components/FriendDiscoveryList.js');
  const buttons = read('components/FriendDecisionButtons.js');

  it('the screen starts on the list, reads Friends\' own column and renders the list unless cards was chosen', () => {
    expect(screen).toContain("useState('list')");
    expect(screen).toContain('friend_discovery_view_style');
    expect(screen).toContain('friendViewStyle(mine?.friend_discovery_view_style)');
    expect(screen).toMatch(/viewStyle === 'cards' \? \(\s*<FriendDiscoverySwipeCards[\s\S]*?\) : \(\s*<FriendDiscoveryList/);
    expect(screen).not.toMatch(/\bdiscovery_view_style\b(?<!friend_discovery_view_style)/);
    expect(screen).not.toContain('swipeToMeetNewPeople');
  });

  it('both modes decide through the one labelled pair and the one decide path', () => {
    expect(deck).toContain('<FriendDecisionButtons');
    expect(list).toContain('<FriendDecisionButtons');
    expect(screen).toContain('onSwipe={handleDecide}');
    expect(screen).toContain('onDecide={handleDecide}');
    expect(buttons).toContain('t(pass.labelKey)');
    expect(buttons).toContain('t(connect.labelKey)');
  });

  it('no decision button is a bare symbol (✕ / 🤝 / ✓ / ♥ as a button\'s only content)', () => {
    for (const src of [deck, list, buttons]) {
      expect(src).not.toMatch(/<Text[^>]*>\s*(✕|🤝|✓|♥|❤️|👍|👎)\s*<\/Text>\s*<\/TouchableOpacity>/u);
    }
    expect(deck).not.toMatch(/skipButtonText|likeButtonText/);
  });

  it('the list adds no swipe and no motion', () => {
    expect(list).not.toMatch(/PanResponder|Animated|LayoutAnimation|Haptics/);
    expect(buttons).not.toMatch(/PanResponder|Animated|LayoutAnimation|Haptics/);
  });

  it('Dating keeps its own setting; Settings writes Friends\' column separately', () => {
    expect(read('screens/DiscoveryScreen.js')).toContain("discovery_view_style: newStyle");
    const s = read('screens/SettingsScreen.js');
    expect(s).toContain('update({ discovery_view_style: style })');
    expect(s).toContain('update({ friend_discovery_view_style: style })');
  });
});
