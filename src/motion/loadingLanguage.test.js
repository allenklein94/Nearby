const { LOADING_KINDS, PLANNING_CAPTIONS, resolveLoadingCaption } = require('./loadingLanguage');

test('the five named kinds of Nearby work all have captions', () => {
  ['people', 'activities', 'businesses', 'availability', 'recommendations'].forEach((k) => {
    expect(LOADING_KINDS[k]).toMatch(/…$/);
  });
});
test('caption override wins, then kind, else none', () => {
  expect(resolveLoadingCaption({ kind: 'people', caption: 'Custom…' })).toBe('Custom…');
  expect(resolveLoadingCaption({ kind: 'people' })).toBe('Finding people…');
  expect(resolveLoadingCaption({ kind: 'nope' })).toBeNull();
  expect(resolveLoadingCaption()).toBeNull();
});
test('captions never fabricate counts or progress', () => {
  [...Object.values(LOADING_KINDS), ...PLANNING_CAPTIONS].forEach((c) => {
    expect(c).not.toMatch(/\d/);
    expect(c).not.toMatch(/%/);
  });
});
test('skeletons and the N loader are two distinct, both-present treatments (Item 133)', () => {
  const fs = require('fs'); const path = require('path');
  // Skeleton = a known feed's content is loading; N = Nearby is finding/thinking.
  expect(fs.existsSync(path.join(__dirname, '../components/SkeletonCard.js'))).toBe(true);
  expect(fs.existsSync(path.join(__dirname, '../components/SkeletonGridCard.js'))).toBe(true);
  expect(fs.existsSync(path.join(__dirname, 'SkeletonFeed.js'))).toBe(true);
  expect(fs.existsSync(path.join(__dirname, 'NLoader.js'))).toBe(true);
});
test('feeds of the user\'s own content use skeletons; finding/searching uses the N', () => {
  const fs = require('fs'); const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../screens', f), 'utf8');
  ['MatchesScreen.js', 'FriendsScreen.js', 'PlansScreen.js', 'TimelineScreen.js', 'ActivityScreen.js'].forEach((f) => {
    expect(read(f)).toMatch(/<SkeletonFeed/);
  });
  ['PlacesScreen.js', 'HomeScreen.js', 'DiscoverHubScreen.js'].forEach((f) => {
    expect(read(f)).toMatch(/<NLoader fullScreen=\{false\}/);
  });
});
