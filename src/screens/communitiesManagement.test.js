import fs from 'fs';
import path from 'path';

// Rule 14 (owner, 2026-10-04): the Communities screen manages the person's own communities; finding and joining public
// communities has ONE home, Discover -> Communities.
const SRC = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return /\.js$/.test(e.name) && !/\.(test|journey)\.js$/.test(e.name) ? [p] : [];
});

describe('one public-community discovery list: Discover -> Communities', () => {
  it('no screen or component other than Discover reads the public community list', () => {
    const readers = walk(SRC)
      .filter((f) => !f.includes(`${path.sep}services${path.sep}`))
      .filter((f) => /\b(getPublicCommunities|searchPublicCommunities)\s*\(/.test(fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')))
      .map((f) => path.relative(SRC, f));
    expect(readers).toEqual([path.join('screens', 'DiscoverHubScreen.js')]);
  });
  it('the Communities screen is Your Communities + Create, with a link to Discover and no Join buttons', () => {
    const src = read('screens/CommunitiesScreen.js');
    expect(src).not.toMatch(/joinCommunity|getPublicCommunities|ui\.community\.join'/);
    expect(src).toMatch(/navigateKeepingTrail\(navigation, 'Discover', \{ \.\.\.DISCOVER_COMMUNITIES \}\)/);
    expect(src).toMatch(/initialTypeTab: 'communities'/);
    expect(src).toMatch(/navigation\.navigate\('CreateCommunity'\)/);
    expect(src).toMatch(/navigation\.navigate\('CommunityDetail'/);
  });
});
