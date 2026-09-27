import { searchResultTabs, topResultKinds, effectiveResultTab, resultKindView, TOP_PER_KIND, TOP_KIND_LIMIT } from './searchResultTabs';

const keys = (tabs) => tabs.map((t) => t.key);
const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');

describe('search result tabs (item 93)', () => {
  it('shows only tabs that have results, Top Results always first', () => {
    expect(keys(searchResultTabs({ plans: 3, places: 0, offers: 1, activities: 0 }))).toEqual(['top', 'plans', 'offers']);
    expect(keys(searchResultTabs({}))).toEqual(['top']);
  });
  it('fixed tab order: Top Results, Places, Activities, Plans, Offers', () => {
    expect(searchResultTabs({ plans: 1, places: 1, offers: 1, activities: 1 }).map((t) => t.label))
      .toEqual(['Top Results', 'Places', 'Activities', 'Plans', 'Offers']);
  });
  it('until every source has answered for this term, no category tab or preview exists (no placeholders)', () => {
    const counts = { plans: 3, places: 2, offers: 1, activities: 1 };
    expect(keys(searchResultTabs(counts, { settled: false }))).toEqual(['top']);
    expect(topResultKinds(counts, { settled: false })).toEqual([]);
    expect(topResultKinds(counts, { settled: true })).toEqual(['plans', 'places', 'offers']);
  });
  it('fixed order regardless of which source answered first or how big each list is', () => {
    expect(topResultKinds({ activities: 9, offers: 7, places: 1, plans: 1 })).toEqual(['plans', 'places', 'offers']);
    expect(topResultKinds({ activities: 9, offers: 7, places: 1 })).toEqual(['places', 'offers', 'activities']);
  });
  it('fewer than three categories with results: only those, nothing padded', () => {
    expect(topResultKinds({ places: 2 })).toEqual(['places']);
    expect(topResultKinds({ plans: 0, places: 0, offers: 0, activities: 0 })).toEqual([]);
    expect(keys(searchResultTabs({ places: 2, offers: 1 }))).toEqual(['top', 'places', 'offers']);
  });
  it('Top Results previews at most three kinds in a fixed order', () => {
    expect(topResultKinds({ plans: 5, places: 2, offers: 1, activities: 4 })).toEqual(['plans', 'places', 'offers']);
    expect(topResultKinds({ plans: 0, places: 0, offers: 2, activities: 1 })).toEqual(['offers', 'activities']);
    expect(topResultKinds({ plans: 5, places: 5, offers: 5, activities: 5 })).toHaveLength(TOP_KIND_LIMIT);
  });
  it('a chosen tab that no longer has results falls back to Top Results', () => {
    const tabs = searchResultTabs({ plans: 2 });
    expect(effectiveResultTab('plans', tabs)).toBe('plans');
    expect(effectiveResultTab('offers', tabs)).toBe('top');
  });
  it('Top shows two per previewed kind; a tab shows its whole list; other kinds are hidden', () => {
    expect(resultKindView('plans', 'top', ['plans'])).toEqual({ show: true, cap: TOP_PER_KIND });
    expect(resultKindView('offers', 'top', ['plans'])).toEqual({ show: false, cap: 0 });
    expect(resultKindView('offers', 'offers', [])).toEqual({ show: true, cap: null });
    expect(resultKindView('plans', 'offers', ['plans'])).toEqual({ show: false, cap: 0 });
  });
  it('"Things To Do" is not a result tab (it is the Discover mode itself)', () => {
    expect(searchResultTabs({ plans: 1, places: 1, offers: 1, activities: 1 }).map((t) => t.label)).not.toContain('Things To Do');
  });
  it('Discover wiring: tabs replace the type chips only during an All-view search; search still covers everything', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/const resultTabsActive = isAll && isSearching;/);
    expect(d).toMatch(/\(resultTabsActive \? resultTabs : TYPE_FILTERS\)\.map/);
    expect(d).toMatch(/const showGatherings = typeShowsGatherings && kindView\('plans'\)\.show;/);
    expect(d).toMatch(/const showPerks = typeShowsPerks && kindView\('offers'\)\.show;/);
    expect(d).toMatch(/businessesToShow = kindView\('places'\)\.show/);
    // every source is still searched regardless of the tab
    expect(d).toMatch(/searchGatherings\(term, 'wide'\),\s*searchPublicCommunities\(term\),\s*searchOffers\(/);
    expect(d).toMatch(/setSearchQuery\(t\);\s*setSearchTab\('top'\);/);
  });
  it('typing or clearing resets the selection to Top Results', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/setSearchQuery\(t\);\s*setSearchTab\('top'\);/);
    expect(d).toMatch(/setSearchQuery\(''\);\s*setSearchTab\('top'\);/);
  });
  it('an empty chosen tab resets the SELECTION to Top Results once results settle', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/if \(resultTabsActive && resultsSettled && searchTab !== 'top' && !resultTabKey\.split\('\|'\)\.includes\(searchTab\)\) setSearchTab\('top'\);/);
  });
  it('a type chosen before searching stays the constraint: no result tabs, that type only, full list', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/const resultTabsActive = isAll && isSearching;/);
    expect(d).toMatch(/kindView = \(kind\) => \(resultTabsActive \? resultKindView\(kind, resultTab, topKinds\) : \{ show: true, cap: isAll \? PREVIEW_COUNT : null \}\)/);
    expect(d).toMatch(/const typeShowsGatherings = typeFilter === 'all' \|\| typeFilter === 'gatherings';/);
  });
  it('a previous query\'s results are never shown under a new one', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/const searchResultsFresh = !isSearching \|\| searchedTerm === query\.literalTerm;/);
    expect(d).toMatch(/const loadingSearch = loadingSearchRaw \|\| !searchResultsFresh;/);
    expect(d).toMatch(/isSearching \? \(searchResultsFresh \? searchedGatherings : \[\]\)/);
    expect(d).toMatch(/isSearching \? \(searchResultsFresh \? searchedCommunities : \[\]\)/);
    expect(d).toMatch(/isSearching \? \(searchResultsFresh \? searchedOffers : \[\]\)/);
    expect(d).toMatch(/applyOpenNow\(placesFresh \? places : \[\], placeEntity\)/);
    expect(d).toMatch(/setSearchedTerm\(term\);/);
    expect(d).toMatch(/setPlacesTerm\(keyword \?\? null\)/);
    expect(d).toMatch(/const resultsSettled = !loadingSearch && !\(userLocation && placesPending\);/);
  });
});
