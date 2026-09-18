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
test('skeleton components are gone (N is the one loading language)', () => {
  const fs = require('fs'); const path = require('path');
  expect(fs.existsSync(path.join(__dirname, '../components/SkeletonCard.js'))).toBe(false);
  expect(fs.existsSync(path.join(__dirname, '../components/SkeletonGridCard.js'))).toBe(false);
});
