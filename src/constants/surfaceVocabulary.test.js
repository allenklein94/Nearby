const fs = require('fs');
const path = require('path');
const { SURFACES } = require('./surfaceVocabulary');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('surface vocabulary', () => {
  it('every surface states a meaning and where it is used', () => {
    for (const s of Object.values(SURFACES)) {
      expect(s.label).toBeTruthy();
      expect(s.means.length).toBeGreaterThan(20);
      expect(s.where).toBeTruthy();
    }
  });
  it('labels are unique', () => {
    const labels = Object.values(SURFACES).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('Home does not call a ranked recommendation list "Right Now"', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).not.toMatch(/sectionHeaderText\}>Nearby Right Now</);
    expect(home).toMatch(/>Recommended Nearby</);
  });
  it('the Gatherings feed (any date) is not titled "Happening Nearby"', () => {
    const t = read('i18n/translations.js');
    expect(t).not.toMatch(/title: 'Happening Nearby'/);
    expect(t).toMatch(/title: 'Nearby Gatherings'/);
  });
  it('Happening Nearby remains the expiring-moments row on Discover', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/Happening Nearby<\/Text>/);
    expect(d).toMatch(/happeningNearby = \[\s*\.\.\.gatheringStories/);
  });
  it('Trending shares one attendance floor', () => {
    expect(read('constants/trending.js')).toMatch(/TRENDING_ATTENDANCE_MIN = 5/);
  });
});
