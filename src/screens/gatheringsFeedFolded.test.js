// Screen-reduction audit B3 (owner, 2026-10-09): the separate Gatherings feed folded into Discover -> Gatherings. Its useful
// filters live on that tab, ONE ordering (Discover's ladder) serves every gathering list, and every entry point moved.
const fs = require('fs');
const path = require('path');
const { RULE14_DECISIONS } = require('../constants/screenRegistry');
const { notificationDestination } = require('../navigation/notificationDestinations');
const { GATHERINGS_TAB } = require('../utils/gatheringFilters');

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? walk(path.join(d, e.name)) : (e.name.endsWith('.js') && !e.name.includes('.test.') ? [path.join(d, e.name)] : [])));

describe('the Gatherings feed is folded into Discover', () => {
  test('the screen and its separate ranker are gone, and the fold is recorded', () => {
    expect(fs.existsSync(path.join(__dirname, 'GatheringsScreen.js'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'utils', 'gatheringFeedRanking.js'))).toBe(false);
    expect(RULE14_DECISIONS.folded.Gatherings).toMatch(/Discover -> Gatherings/);
  });
  test('nothing navigates to the old route', () => {
    const offenders = walk(SRC).filter((f) => /navigate\(\s*'Gatherings'|to\('Gatherings'|screen: 'Gatherings'|name="Gatherings"/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  test('every former entry opens Discover -> Gatherings through the one params builder', () => {
    expect(read('screens/HomeScreen.js')).toMatch(/navigateKeepingTrail\(navigation, 'Discover', gatheringsTabParams\(\{/);
    expect(read('utils/homeQuiet.js')).toMatch(/screen: 'Discover', params: gatheringsTabParams\(\{ when: 'today' \}\)/);
    expect(read('screens/MomentumScreen.js')).toMatch(/navigateKeepingTrail\(navigation, 'Discover', gatheringsTabParams\(\)\)/);
    expect(read('components/GatheringFeedbackModal.js')).toMatch(/navigateKeepingTrail\(navigation, 'Discover', gatheringsTabParams\(\)\)/);
  });
  test.each(['gathering_cancelled', 'first_mission_reminder', 'gathering_interest', 'gathering_reminder'])(
    'a %s push with nothing to open lands on Discover -> Gatherings (the tab switch keeps a return trail)', async (type) => {
      const dest = await notificationDestination({ type });
      expect(dest).toEqual({ name: 'MainTabs', params: { screen: 'Discover', params: { ...GATHERINGS_TAB } } });
    });
  test('Discover applies the filters only on its Gatherings tab and ranks that list by the one ladder', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/if \(p\.initialTypeTab === 'gatherings'\) setGatheringFilters\(gatheringFiltersFromParams\(p\.gatheringFilters\)\)/);
    expect(d).toMatch(/const dedupedGatherings = gatheringTabActive && !isSearching \? byLadder\(dedupedGatheringsRaw\) : dedupedGatheringsRaw;/);
    expect(d).toMatch(/\{gatheringTabActive && renderGatheringFilterRows\(\)\}/);
    // the onboarding comfort answer kept its place in the one ladder
    expect(d).toMatch(/comfortFits\(g\.group_size_feel, personalization\.socialComfort\) \? COMFORT_POINTS : 0/);
    // no second gathering ordering anywhere
    expect(walk(SRC).filter((f) => /rankGatheringFeed|feedRankParts/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });
});
