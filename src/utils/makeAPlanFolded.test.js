// Screen-reduction audit B4 (owner, 2026-10-08): "Make a plan" at a business is the ONE gathering-creation flow
// (CreateGathering opened with fromBusiness), never a second screen. The old MakeAPlan created gatherings with no category
// and hard-coded public visibility; Create's own required category and visibility choices now apply.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

test('no screen, route, push or shortcut opens MakeAPlan any more', () => {
  expect(fs.existsSync(path.join(SRC, 'screens/MakeAPlanScreen.js'))).toBe(false);
  const callers = walk(SRC).filter((f) => /['"]MakeAPlan['"]/.test(fs.readFileSync(f, 'utf8')));
  expect(callers.map((f) => path.relative(SRC, f))).toEqual([]);
});

test('every former MakeAPlan entry opens CreateGathering with the one fromBusiness shape', () => {
  expect(read('screens/HomeScreen.js')).toMatch(/navigate\('CreateGathering', createFromBusinessParams\(\{ offerId: item\.id \}\)\)/);
  expect(read('screens/HomeScreen.js')).toMatch(/createFromBusinessParams\(\{ partnerId: occasionRecall\.partnerId, title: occasionNudge\.title \}\)/);
  expect(read('screens/BusinessProfileScreen.js').match(/navigate\('CreateGathering', createFromBusinessParams\(\{ partnerId \}\)\)/g)).toHaveLength(2);
  expect(read('navigation/notificationDestinations.js')).toMatch(/to\('CreateGathering', createFromBusinessParams\(\{\s*partnerId: data\.partner_id/);
});

test('CreateGathering fills only what is empty, turns the invite step on, and keeps its own visibility and category rules', () => {
  const src = read('screens/CreateGatheringScreen.js');
  expect(src).toMatch(/businessPlanPrefill\(\{ offer, partner, title: fromTitle \}\)/);
  expect(src).toMatch(/setTitle\(\(cur\) => \(cur\.trim\(\) \? cur : prefill\.title\)\)/);
  expect(src).toMatch(/setInterestTag\(\(cur\) => cur \?\? prefill\.category\)/);
  expect(src).toMatch(/\|\| !!fromBusiness;/);
  // visibility is the person's choice in the normal step, never hard-coded for this entry
  expect(src).not.toMatch(/fromBusiness[\s\S]{0,200}setVisibility/);
  expect(src).toMatch(/const isPublic = visibility !== 'invite_only';/);
});
