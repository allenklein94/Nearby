// Owner item 190 (2026-10-04, LOCKED): the UI never manufactures a business need. A typed ask on the item-189 public-place
// allowlist offers no "Ask nearby businesses"; any other ask keeps it as a SECONDARY link under "Create it yourself".
const fs = require('fs');
const path = require('path');
const { askBusinessesFits, placesToGoActivity, PLACES_TO_GO_ACTIVITIES } = require('./placesToGo');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const home = read('src/screens/HomeScreen.js');
const discover = read('src/screens/DiscoverHubScreen.js');

describe('which asks get a business CTA', () => {
  it('"go for a walk tonight" and "find a park" get none', () => {
    expect(askBusinessesFits('go for a walk tonight')).toBe(false);
    expect(askBusinessesFits('find a park')).toBe(false);
    for (const t of ['hike tomorrow', 'beach day', 'picnic saturday', 'scenic views at sunset', 'playground for the kids']) expect(askBusinessesFits(t)).toBe(false);
  });

  it('a normal business/service ask still can', () => {
    for (const t of ['I need a haircut today', 'coffee for four tonight', 'dinner with friends', 'birthday party for 20', 'something fun tonight']) {
      expect(askBusinessesFits(t)).toBe(true);
    }
  });

  it('one definition: the gate is exactly the item-189 allowlist, nothing else', () => {
    const src = read('src/utils/placesToGo.js');
    expect(src).toMatch(/export function askBusinessesFits\(text\) \{\s*return placesToGoActivity\(text\) == null;\s*\}/);
    expect(PLACES_TO_GO_ACTIVITIES).toHaveLength(10);
    expect(placesToGoActivity('find a park')).toBe('Parks');
  });
});

describe('the screens', () => {
  it('every typed-ask "Ask nearby businesses" on Home and Discover sits behind the gate', () => {
    const homeCtas = [...home.matchAll(/askBusinessesFits\((intentResults|intentEmptyFallback)\.typedText\) && \(\s*<TouchableOpacity onPress=\{(handleAskBusinessFromResults|handleAskBusiness)\}/g)];
    expect(homeCtas).toHaveLength(2);
    expect((home.match(/t\('ui\.home\.askBusinesses'\)/g) ?? []).length).toBe(2);
    expect(discover).toMatch(/askBusinessesFits\(intentSearch\.typedText \?\? searchQuery\.trim\(\)\) && \(\s*<TouchableOpacity\s+onPress=\{\(\) => askBusinessFromAsk/);
  });

  it('Create it yourself stays and leads; businesses are a text link, never the filled button', () => {
    expect(home).not.toMatch(/askBusinessButton/);
    expect((home.match(/style=\{styles\.primaryCreateButton\} onPress=\{\(\) => proceedToCreation\(/g) ?? []).length).toBe(2);
    expect(home).toMatch(/<Text style=\{styles\.intentResultsCreateNew\}>\{t\('ui\.home\.askBusinesses'\)\}/);
    const i = discover.indexOf('onPress={createFromAsk}');
    const j = discover.indexOf('askBusinessesFits(intentSearch.typedText');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it('Places to go stays separate from businesses: rendered before the actions, carrying only places', () => {
    for (const src of [home, discover]) {
      const p = src.indexOf('<PlacesToGoSection');
      expect(p).toBeGreaterThan(0);
      expect(src.indexOf('askBusinessesFits(', p)).toBeGreaterThan(p);
    }
    expect(read('src/components/PlacesToGoSection.js')).not.toMatch(/AskBusiness|askBusiness|partner|navigate\(/);
  });

  it('presentation only: no matching, routing, ranking or eligibility code reads the gate', () => {
    for (const f of ['src/services/intentResolver.js', 'src/utils/askEligibility.js', 'src/constants/signalPriority.js', 'src/services/askToBusiness.js']) {
      expect(read(f)).not.toMatch(/askBusinessesFits|placesToGo/);
    }
  });
});
