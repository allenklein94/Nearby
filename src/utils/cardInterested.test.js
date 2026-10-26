import fs from 'fs';
import path from 'path';
import { cardInterestedEligible, interestedSetWith, overridesAfterRefresh, firstInterestedDisclosureKey } from './cardInterested';
import { gatheringPrimaryAction, gatheringActionOpenParams } from './primaryAction';
import { gatheringCardModel } from './recommendationCard';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

// Owner, 2026-10-25: Interested from a Discover card (a narrow exception to item 200), sharing Home's card toggle.
describe('card Interested rules', () => {
  it('the ☆ shows only beside a join action, and only when the Interested set is known', () => {
    const set = new Set();
    for (const kind of ['join']) expect(cardInterestedEligible({ kind }, set)).toBe(true);
    for (const kind of ['view', 'view_plan', 'requested', 'interested']) expect(cardInterestedEligible({ kind }, set)).toBe(false);
    expect(cardInterestedEligible({ kind: 'join' }, null)).toBe(false); // unknown = no star, never a guessed "off"
    expect(cardInterestedEligible(null, set)).toBe(false);
  });

  it('a tap shows at once over the server read, and removing it again works', () => {
    expect(interestedSetWith(null, { a: true })).toBeNull();
    const on = interestedSetWith(['x'], { a: true });
    expect([...on].sort()).toEqual(['a', 'x']);
    const off = interestedSetWith(new Set(['a', 'x']), { a: false });
    expect([...off]).toEqual(['x']);
  });

  it('a fresh read (GatheringDetail, Home or Discover changed it) wins over every settled tap', () => {
    expect(overridesAfterRefresh({ a: true, b: false }, new Set())).toEqual({});
    expect(overridesAfterRefresh({ a: true, b: false }, new Set(['b']))).toEqual({ b: false }); // a save still in flight keeps it
  });

  it('the first Interested is explained whether or not sharing is on, until acknowledged (idea "356")', () => {
    expect(firstInterestedDisclosureKey({ share: false, acknowledged: false })).toBe('ui.gatheringDetail.demandDisclosureOptional');
    expect(firstInterestedDisclosureKey({ share: true, acknowledged: false })).toBe('ui.gatheringDetail.demandDisclosure');
    expect(firstInterestedDisclosureKey({ share: undefined, acknowledged: false })).toBe('ui.gatheringDetail.demandDisclosureOptional');
    expect(firstInterestedDisclosureKey({ share: true, acknowledged: true })).toBeNull();
    expect(firstInterestedDisclosureKey(null)).toBeNull();
  });

  it('marking Interested never changes the join action: still Join (owner 2026-10-26, never "I\'m Going")', () => {
    const g = { id: 'g1', host_id: 'h', visibility: 'public', scheduled_at: new Date(Date.now() + 86400000).toISOString(), attendees: [], capacity: null };
    const marked = gatheringPrimaryAction(g, 'me', Date.now(), { interestedIds: new Set(['g1']) });
    const plain = gatheringPrimaryAction(g, 'me', Date.now(), { interestedIds: new Set() });
    expect(marked.kind).toBe('join');
    expect(plain.kind).toBe('join');
    expect(marked.label).toBe(plain.label);
    expect(marked.label).toBe('Join');
  });
});

describe('card Interested navigation', () => {
  const g = { id: 'g1', host_id: 'h', title: 'Beach volleyball', visibility: 'public', scheduled_at: new Date(Date.now() + 86400000).toISOString(), attendees: [], capacity: null };
  it('marking Interested never changes where the card body goes: plain GatheringDetail, no join step', () => {
    for (const ids of [new Set(), new Set(['g1'])]) {
      const card = gatheringCardModel(g, { myUserId: 'me', actionOpts: { interestedIds: ids } });
      expect(card.destination?.screen).toBe('GatheringDetail');
      expect(card.destination?.params?.openJoin).toBeUndefined();
      expect(card.action.kind).toBe('join'); // Join stays the primary action either way
      expect(gatheringActionOpenParams(card.action)).toEqual({ openJoin: true }); // only the join action opens the join step
    }
  });
});

describe('card Interested wiring', () => {
  const hook = read('src/hooks/useCardInterested.js');
  const home = read('src/screens/HomeScreen.js');
  const discover = read('src/screens/DiscoverHubScreen.js');
  const star = read('src/components/CardInterestedStar.js');

  it('Home and Discover share the one hook; neither keeps its own toggle', () => {
    expect(home).toMatch(/useCardInterested\(\{ interestedIds:/);
    expect(discover).toMatch(/useCardInterested\(\{ interestedIds: myInterestedIds, navigation \}\)/);
    for (const src of [home, discover]) {
      expect(src).not.toMatch(/setGatheringInterested\(/);
      expect(src).not.toMatch(/toggleCardInterested/);
    }
  });

  it('toggling never leaves the surface; the explanation is shown in place, with the same choices as GatheringDetail', () => {
    expect(hook).not.toMatch(/navigate\('GatheringDetail'/);
    expect(hook).toMatch(/firstInterestedDisclosureKey\(prefs\)/);
    expect(hook).toMatch(/ui\.common\.gotIt/);
    expect(hook).toMatch(/ui\.gatheringDetail\.changeInSettings/);
    expect(hook).toMatch(/acknowledgeInterestedDisclosure\(\)/);
    expect(hook).not.toMatch(/share_interest_in_demand/); // acknowledging never turns sharing on
    expect(home).not.toMatch(/prefs\.share && !prefs\.acknowledged/); // the pre-idea-356 rule that skipped it
  });

  it('the save keeps Undo, and "✓" plays only after the server returned', () => {
    expect(hook).toMatch(/showSuccessToast\(\.\.\.interestedConfirmation\(!on\), \{ undo:/);
    const save = hook.indexOf('await setGatheringInterested(g.id, !on)');
    const flash = hook.indexOf('(f[g.id] ?? 0) + 1');
    expect(save).toBeGreaterThan(0);
    expect(flash).toBeGreaterThan(save);
  });

  it('the ☆ sits on Discover gathering tiles only (hero, standard, compact, context row) and the card body keeps its tap', () => {
    expect((discover.match(/\{interestedStar\(g, card/g) ?? []).length).toBe(4);
    expect(discover).toMatch(/if \(!cardInterestedEligible\(card\.action, set\)\) return null;/);
    expect(discover).not.toMatch(/renderHappeningNowTile[\s\S]{0,1500}interestedStar/);
  });

  it('the ☆ is secondary, uses existing strings only, and tells state by shape, not colour alone', () => {
    expect(star).toMatch(/on \? '★' : '☆'/);
    expect(star).toMatch(/ui\.home\.removeInterestedA11y/);
    expect(star).toMatch(/ui\.home\.markInterestedA11y/);
    expect(star).toMatch(/accessibilityState=\{\{ selected: !!on \}\}/);
    expect(star).not.toMatch(/navigate/);
  });

  it('the old "go to the detail screen first" strings are gone', () => {
    expect(read('src/i18n/ui/home.js')).not.toMatch(/oneQuickStep/);
  });
});
