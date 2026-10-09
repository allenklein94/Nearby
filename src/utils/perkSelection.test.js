// Perks have ONE surface (owner, 2026-10-04): Discover -> Perks, normal list / selected perk. BrandOffersScreen is gone;
// every perk entry opens Discover's Perks, and a link to one perk selects it in place (redemption under its own card).
import fs from 'fs';
import path from 'path';
import { listWithSelectedPerk } from './perkSelection';
import { perkDestination, intentResultDestination, PERKS_TAB } from './recommendationContext';
import { satisfiesContract } from '../constants/destinationContract';
import { goalShortcuts } from '../constants/onboardingGoals';
import { navigateKeepingTrail } from '../services/openDestination';
import { getTrail, clearTrail } from '../navigation/returnTrail';

jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

describe('one Perks surface', () => {
  it('BrandOffersScreen no longer exists and nothing opens it', () => {
    expect(fs.existsSync(path.join(SRC, 'screens/BrandOffersScreen.js'))).toBe(false);
    const offenders = walk(SRC).filter((f) => /['"]BrandOffers['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('a perk opens Discover -> Perks with that perk selected, and honors the destination contract', () => {
    const d = perkDestination('p1');
    expect(d).toEqual({ kind: 'navigate', screen: 'Discover', params: { initialMode: 'things', initialTypeTab: 'perks', selectPerkId: 'p1' } });
    expect(satisfiesContract('perk', d)).toBe(true);
    expect(satisfiesContract('perk', intentResultDestination({ type: 'perk', id: 'p2' }))).toBe(true);
    expect(intentResultDestination({ type: 'sponsored', itemKind: 'offer', itemId: 'p3' })).toEqual(perkDestination('p3'));
    expect(perkDestination(null)).toBeNull();
  });

  it('the plain perk entry points open the Perks tab with a fresh params object (so Discover re-applies it)', () => {
    for (const f of ['Home', 'Matches', 'Settings']) {
      const src = read(`screens/${f}Screen.js`);
      expect(src).toMatch(/navigateKeepingTrail\(navigation, 'Discover', \{ \.\.\.PERKS_TAB \}\)/);
    }
    expect(PERKS_TAB).toEqual({ initialMode: 'things', initialTypeTab: 'perks' });
  });

  it('the "Find businesses and offers" goal shortcut opens the Perks tab', () => {
    const [s] = goalShortcuts(['Find businesses and offers']);
    expect(s.route).toBe('Discover');
    expect(s.params).toEqual({ initialMode: 'things', initialTypeTab: 'perks' });
  });
});

describe('the selected perk is always on screen', () => {
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' };
  it('leaves the list alone when nothing is selected or the selection is already shown', () => {
    expect(listWithSelectedPerk([a, b], null, [c])).toEqual([a, b]);
    expect(listWithSelectedPerk([a, b], 'b', [c])).toEqual([a, b]);
  });
  it('puts a selected perk the list left out first, from the loaded perks', () => {
    expect(listWithSelectedPerk([a], 'c', [b, c])).toEqual([c, a]);
    expect(listWithSelectedPerk([], 'c', [], [c])).toEqual([c]);
  });
  it('never invents a perk that is not loaded', () => {
    expect(listWithSelectedPerk([a], 'zzz', [b])).toEqual([a]);
  });
});

describe('opening a tab from a screen above the tabs keeps the way back', () => {
  afterEach(() => clearTrail());
  const fakeNav = (rootState) => {
    const root = { getParent: () => null, getState: () => rootState };
    return { getParent: () => root, navigate: jest.fn() };
  };
  it('remembers the screens it closes', () => {
    const nav = fakeNav({ index: 1, routes: [{ name: 'MainTabs' }, { name: 'Momentum' }] });
    navigateKeepingTrail(nav, 'Discover', { ...PERKS_TAB });
    expect(getTrail()).toMatchObject({ tab: 'Discover', routes: [{ name: 'Momentum' }] });
    expect(nav.navigate).toHaveBeenCalledWith('Discover', PERKS_TAB);
  });
  it('starts no trail from a tab, and never for a non-tab screen', () => {
    navigateKeepingTrail(fakeNav({ index: 0, routes: [{ name: 'MainTabs' }] }), 'Discover', {});
    expect(getTrail()).toBeNull();
    navigateKeepingTrail(fakeNav({ index: 1, routes: [{ name: 'MainTabs' }, { name: 'Momentum' }] }), 'GatheringDetail', {});
    expect(getTrail()).toBeNull();
  });
});

describe('Discover owns browsing AND redemption, in place', () => {
  const discover = read('screens/DiscoverHubScreen.js');
  const panel = read('components/PerkRedemptionPanel.js');
  it('a perk card selects in place instead of navigating', () => {
    const fn = discover.slice(discover.indexOf('function renderPerkCard('), discover.indexOf('function withSelectedPerk('));
    expect(fn).toMatch(/selectPerk\(o\.id\)/);
    expect(fn).not.toMatch(/pc\.destination/);
    expect(fn).toMatch(/<PerkRedemptionPanel/);
    // both perk lists and the map use the one card / selection
    expect(discover).toMatch(/withSelectedPerk\(offersToShow\)\.map\(\(o\) => renderPerkCard\(o\)\)/);
    expect(discover).toMatch(/contextOffers\.map\(\(o\) => renderPerkCard\(o\)\)/);
    expect(discover).toMatch(/onSelectDeal=\{\(d\) => \{ setViewStyle\('list'\); selectPerk\(d\.id\)/);
  });
  it('a link selects the perk; any other arrival starts unselected', () => {
    const effect = discover.slice(discover.indexOf('const appliedParamsRef'), discover.indexOf('}, [route.params]);'));
    expect(effect).toMatch(/if \(p\.selectPerkId\)[\s\S]*selectPerk\(p\.selectPerkId, \{ fromLink: true \}\)[\s\S]*else \{\s*clearPerkSelection\(\);/);
  });
  it('selection is temporary: Back clears it, switching tabs or leaving Perks ends it', () => {
    expect(discover).toMatch(/hardwareBackPress', \(\) => \{\s*const backToOrigin = selectedPerkFromLink && getTrail\(\)\?\.tab === 'Discover';\s*clearPerkSelection\(\);/);
    expect(discover).toMatch(/addListener\('blur'[\s\S]{0,300}clearPerkSelection\(\)/);
    expect(discover).toMatch(/if \(selectedPerkId && !perksTabShown\) clearPerkSelection\(\);/);
  });
  it('the panel redeems in place with every capability the old screen had, and never navigates', () => {
    for (const fn of ['redeemOffer', 'followBusiness', 'unfollowBusiness', 'isFollowingBusiness', 'getRedemptionCounts', 'unlockStatus', 'getCommunityMemberCount', 'getApprovedAttendeeCount']) {
      expect(panel).toMatch(new RegExp(`\\b${fn}\\(`));
    }
    expect(panel).toMatch(/showStaffCode/); // staff code shown in place
    expect(panel).toMatch(/stayConnectedWith/); // optional follow, never a default opt-in
    expect(panel).toMatch(/spotsLeftOf/);
    expect(panel).not.toMatch(/navigation\./);
  });
});
