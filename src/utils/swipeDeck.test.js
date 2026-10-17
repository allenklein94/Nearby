// Regression tests for the swipe-deck stale-card defect (owner, 2026-10-17): Dating's and Friends' decks built their pan
// handler once, so every swipe after the first acted on the FIRST card again and the deck stopped advancing. Both decks
// now run through createSwipeDeck; these tests drive it the way the components do, with the gesture handler captured
// ONCE before any later render (exactly how the PanResponder holds it) and the fly-off animation completed by hand.
import fs from 'fs';
import path from 'path';
import { createSwipeDeck, releaseDirection } from './swipeDeck';
import { DATING_DECK_ACTIONS } from './datingDeckActions';

const people = (...ids) => ids.map((id) => ({ id, otherUserId: `u-${id}` }));

// A deck wired like the components: animation finishes only when the test says so; decisions are logged by person.
function makeDeck({ items, decide = () => true, keyOf } = {}) {
  const log = [];
  const pending = [];
  let changes = 0;
  const deck = createSwipeDeck({
    keyOf,
    animateOut: (dir, done) => pending.push(done),
    onChange: () => { changes += 1; },
  });
  const render = (nextItems = items, onDecide = (p, d) => { log.push([p.id, d]); return decide(p, d); }) => {
    deck.sync({ items: nextItems, onDecide });
  };
  render();
  const land = async () => { const done = pending.shift(); await done(); };
  return { deck, log, render, land, pending, changes: () => changes };
}

describe('releaseDirection', () => {
  it('past the threshold decides; short springs back', () => {
    expect(releaseDirection(120, 100)).toBe('right');
    expect(releaseDirection(-120, 100)).toBe('left');
    expect(releaseDirection(100, 100)).toBeNull();
    expect(releaseDirection(-40, 100)).toBeNull();
  });
});

describe('every swipe acts on the person visible when it completes', () => {
  it('several consecutive swipes through a handler captured once: each acts on the next person and the deck advances', async () => {
    const t = makeDeck({ items: people('a', 'b', 'c', 'd') });
    const gesture = (dir) => t.deck.swipe(dir); // captured once, like PanResponder.create inside useRef
    for (const expected of ['a', 'b', 'c']) {
      expect(t.deck.visible().id).toBe(expected);
      expect(gesture('right')).toBe(true);
      await t.land();
      t.render(); // the component re-renders after each change
    }
    expect(t.log).toEqual([['a', 'right'], ['b', 'right'], ['c', 'right']]);
    expect(t.deck.visible().id).toBe('d');
    expect(t.deck.remaining()).toBe(1);
  });

  it('the handler reads the CURRENT callback and data, never the first render\'s', async () => {
    const t = makeDeck({ items: people('a', 'b') });
    const gesture = (dir) => t.deck.swipe(dir);
    const second = [];
    t.render(people('a', 'b', 'c'), (p, d) => { second.push([p.id, d]); return true; });
    gesture('left');
    await t.land();
    expect(t.log).toEqual([]); // the first render's callback is never called
    expect(second).toEqual([['a', 'left']]);
    expect(t.deck.visible().id).toBe('b');
  });

  it('mixed swipes and button taps share one path and one order', async () => {
    const t = makeDeck({ items: people('a', 'b', 'c', 'd', 'e') });
    const gesture = (dir) => t.deck.swipe(dir);
    const skipButton = () => t.deck.swipe('left');
    const noticeButton = () => t.deck.swipe('right');
    gesture('right'); await t.land(); t.render();
    skipButton(); await t.land(); t.render();
    gesture('left'); await t.land(); t.render();
    noticeButton(); await t.land(); t.render();
    expect(t.log).toEqual([['a', 'right'], ['b', 'left'], ['c', 'left'], ['d', 'right']]);
    expect(t.deck.visible().id).toBe('e');
  });

  it('the person is taken when the gesture completes (release), not when the fly-off ends', async () => {
    const t = makeDeck({ items: people('a', 'b') });
    t.deck.swipe('right');
    t.render(people('z', 'a', 'b')); // new data arrives mid-flight (e.g. a refresh puts someone first)
    await t.land();
    expect(t.log).toEqual([['a', 'right']]);
    t.render(people('z', 'a', 'b'));
    expect(t.deck.visible().id).toBe('z');
  });

  it('appended pages and reorders never bring back or skip a decided person', async () => {
    const t = makeDeck({ items: people('a', 'b', 'c') });
    t.deck.swipe('left'); await t.land();
    t.render(people('c', 'b', 'a', 'd'));
    expect(t.deck.visible().id).toBe('c');
    expect(t.deck.remaining()).toBe(3);
  });

  it('Dating tracks people, not rows: a second row for a decided person stays hidden', async () => {
    const rows = [{ id: 's1', otherUserId: 'p1' }, { id: 's2', otherUserId: 'p2' }];
    const t = makeDeck({ items: rows, keyOf: (r) => r.otherUserId ?? r.id });
    t.deck.swipe('right'); await t.land();
    t.render([{ id: 'gathering-x-p1', otherUserId: 'p1' }, ...rows]);
    expect(t.deck.visible().otherUserId).toBe('p2');
  });
});

describe('rapid gestures cannot act twice or on the wrong person', () => {
  it('swipes and taps during a fly-off are ignored, not queued onto the next person', async () => {
    const t = makeDeck({ items: people('a', 'b', 'c') });
    expect(t.deck.swipe('right')).toBe(true);
    expect(t.deck.isBusy()).toBe(true);
    expect(t.deck.swipe('right')).toBe(false);
    expect(t.deck.swipe('left')).toBe(false);
    expect(t.deck.rewind()).toBe(false);
    expect(t.pending).toHaveLength(1);
    await t.land(); t.render();
    expect(t.log).toEqual([['a', 'right']]);
    expect(t.deck.isBusy()).toBe(false);
    expect(t.deck.visible().id).toBe('b');
    t.deck.swipe('left'); await t.land();
    expect(t.log).toEqual([['a', 'right'], ['b', 'left']]);
  });

  it('an empty deck does nothing', () => {
    const t = makeDeck({ items: [] });
    expect(t.deck.visible()).toBeNull();
    expect(t.deck.swipe('right')).toBe(false);
    expect(t.pending).toHaveLength(0);
  });
});

describe('a failed save never silently advances past the person', () => {
  it.each([
    ['returns false', () => false],
    ['resolves false', async () => false],
    ['throws', () => { throw new Error('network'); }],
    ['rejects', async () => { throw new Error('network'); }],
  ])('a decision that %s brings the person back on top', async (_, decide) => {
    const t = makeDeck({ items: people('a', 'b'), decide });
    t.deck.swipe('right');
    await t.land();
    expect(t.deck.visible().id).toBe('a');
    expect(t.deck.remaining()).toBe(2);
    expect(t.deck.canRewind()).toBe(false);
  });

  it('a failure that arrives after the person swiped on still restores THAT person, and only them', async () => {
    let fail;
    const t = makeDeck({ items: people('a', 'b', 'c'), decide: (p) => (p.id === 'a' ? new Promise((r) => { fail = r; }) : true) });
    t.deck.swipe('right');
    const settledA = t.land();
    t.deck.swipe('left'); await t.land();
    expect(t.deck.visible().id).toBe('c');
    fail(false); await settledA;
    expect(t.deck.visible().id).toBe('a');
    expect(t.deck.remaining()).toBe(2); // a and c; b stays decided
  });

  it('success (undefined or true) keeps the deck advanced', async () => {
    for (const decide of [() => undefined, () => true, async () => true]) {
      const t = makeDeck({ items: people('a', 'b'), decide });
      t.deck.swipe('right'); await t.land();
      expect(t.deck.visible().id).toBe('b');
    }
  });
});

describe('rewind (Dating ↺) and restore (Undo)', () => {
  it('only the last skip can be rewound; a Notice clears it', async () => {
    const t = makeDeck({ items: people('a', 'b', 'c') });
    t.deck.swipe('left'); await t.land();
    expect(t.deck.canRewind()).toBe(true);
    t.deck.swipe('right'); await t.land();
    expect(t.deck.canRewind()).toBe(false);
    expect(t.deck.rewind()).toBe(false);
    expect(t.deck.visible().id).toBe('c');
  });

  it('rewind brings the skipped person back to the top, with nothing sent', async () => {
    const t = makeDeck({ items: people('a', 'b') });
    t.deck.swipe('left'); await t.land();
    expect(t.deck.rewind()).toBe(true);
    expect(t.deck.visible().id).toBe('a');
    expect(t.log).toEqual([['a', 'left']]);
  });

  it('restore (an undone Notice) brings that person back', async () => {
    const t = makeDeck({ items: people('a', 'b'), keyOf: (r) => r.otherUserId });
    t.deck.swipe('right'); await t.land();
    t.deck.restore('u-a');
    expect(t.deck.visible().id).toBe('a');
  });

  it('onAdvanced reports what is left after each decision (Dating loads more at <= 3)', async () => {
    const seen = [];
    const deck = createSwipeDeck({ animateOut: (d, done) => done() });
    deck.sync({ items: people('a', 'b', 'c', 'd', 'e'), onDecide: () => true, onAdvanced: (n) => seen.push(n) });
    deck.swipe('left'); deck.swipe('left');
    expect(seen).toEqual([4, 3]);
  });
});

describe('guards: both decks use the controller; Dating\'s buttons are unchanged', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const dating = read('components/SwipeableDiscoveryCards.js');
  const friends = read('components/FriendDiscoverySwipeCards.js');

  it.each([['Dating', dating], ['Friends', friends]])('%s: the pan handler and buttons go through createSwipeDeck only', (_, src) => {
    expect(src).toContain('createSwipeDeck(');
    expect(src).toMatch(/onMoveShouldSetPanResponder: \(_, gesture\) => !deck\.isBusy\(\)/);
    expect(src).toMatch(/releaseDirection\(gesture\.dx, SWIPE_THRESHOLD\)[\s\S]*?deck\.swipe\(direction\)/);
    expect(src).toContain('deck.sync({');
    expect(src).toContain('const item = deck.visible();');
    // the stale pieces are gone: no index state, no forceSwipe closure, no lookup by a captured index
    expect(src).not.toMatch(/currentIndex|forceSwipe\(|onSwipeComplete|data\[0\]/);
  });

  it('Dating keeps its buttons, symbols, screen-reader labels and swipe meanings', () => {
    // symbols + screen-reader labels unchanged, now read from DATING_DECK_ACTIONS
    expect(DATING_DECK_ACTIONS.rewind).toMatchObject({ glyph: '↺', a11yKey: 'ui.swipeCards.rewindToThePersonYouA11y' });
    expect(DATING_DECK_ACTIONS.skip).toMatchObject({ glyph: '✕', a11yKey: 'ui.swipeCards.skipA11y' });
    expect(DATING_DECK_ACTIONS.wave).toMatchObject({ glyph: '👋', a11yKey: 'ui.swipeCards.sendAWaveToA11y' });
    expect(DATING_DECK_ACTIONS.notice).toMatchObject({ glyph: '♡', a11yKey: 'ui.swipeCards.sendANoticeToA11y' });
    expect(dating).toContain("onPress={() => onWave(item.otherUserId)}"); // Wave never advances the deck
    expect(dating).toMatch(/direction === 'right' \? onNotice\(person\.otherUserId\) : true/); // right = Notice, left = local skip
    expect(dating).toContain("deck.swipe('left')");
    expect(dating).toContain("deck.swipe('right')");
  });

  it('a Notice from the deck reports whether it was saved', () => {
    const screen = read('screens/DiscoveryScreen.js');
    expect(screen).toContain('return sendNotice(toUserId, false);');
    expect(screen).toMatch(/restoreUserId=\{deckRestore\.userId\}/);
  });
});

describe('Dating deck: each visible word matches what its button does (owner, 2026-10-17)', () => {
  const dating = fs.readFileSync(path.join(__dirname, '..', 'components/SwipeableDiscoveryCards.js'), 'utf8');
  const strings = require('../i18n/ui/swipeCards').default;
  const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
  const key = (k) => k.replace('ui.swipeCards.', '');
  // each button: its handler, plus its symbol, word and screen-reader label all from ONE table entry
  const BUTTONS = [
    ['rewind', 'onPress={handleRewind}'],
    ['skip', 'onPress={handleButtonSkip}'],
    ['wave', 'onPress={() => onWave(item.otherUserId)}'],
    ['notice', 'onPress={handleButtonNotice}'],
  ];

  it.each(BUTTONS)('%s: handler, symbol, word and screen-reader label sit on the same button', (name, handler) => {
    const at = dating.indexOf(handler);
    expect(at).toBeGreaterThan(-1);
    const button = dating.slice(dating.lastIndexOf('<TouchableOpacity', at), dating.indexOf('</TouchableOpacity>', at));
    expect(button).toContain(`accessibilityLabel={t(${name}.a11yKey`);
    expect(button).toContain(`{${name}.glyph}`);
    expect(button).toContain(`{t(${name}.labelKey)}`);
  });

  it('the visible word is the short form of the screen-reader label in English', () => {
    const en = strings.en;
    for (const [name] of BUTTONS) {
      const a = DATING_DECK_ACTIONS[name];
      expect(en[key(a.a11yKey)].toLowerCase()).toContain(en[key(a.labelKey)].toLowerCase());
    }
  });

  it('every language has all four words, short enough for a caption', () => {
    for (const l of LANGS) for (const [name] of BUTTONS) {
      const word = strings[l][key(DATING_DECK_ACTIONS[name].labelKey)];
      expect(typeof word).toBe('string');
      expect(word.length).toBeGreaterThan(0);
      expect(word.length).toBeLessThanOrEqual(14);
    }
  });

  it('no swipe instruction in the words (idea 156)', () => {
    for (const l of LANGS) for (const [name] of BUTTONS) expect(strings[l][key(DATING_DECK_ACTIONS[name].labelKey)]).not.toMatch(/swipe/i);
  });
});
