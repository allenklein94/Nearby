// Screen-reduction audit B2 (owner, 2026-10-08): PlanDetail is kept only for plans that combine several objects (a night
// out, an occasion). A gathering, a business request or a match opens its own screen; a gathering or request that is part
// of a bigger plan links UP to it ("Part of: ..."). Partly driven through React Navigation's real Stack router.
const fs = require('fs');
const path = require('path');
const { StackRouter, StackActions, CommonActions } = require('@react-navigation/routers');

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

describe('who still opens PlanDetail', () => {
  test('only multi-object entries: night-out rows, the night-out builder, occasions, and a "Part of" link up', () => {
    const callers = walk(SRC)
      .filter((f) => /navigat\w*\(\s*'PlanDetail'|navigation\.navigate\('PlanDetail'/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f)).sort();
    expect(callers).toEqual([
      'components/ExperienceComponentList.js', // the night out just created
      'screens/BusinessRequestDetailScreen.js', // "Part of: {night / occasion}" only
      'screens/GatheringDetailScreen.js', // "Part of: {night / occasion}" only
      'screens/OccasionsScreen.js', // an occasion and what was planned for it
      'screens/PlansScreen.js', // night-out rows only
    ]);
    expect(read('screens/PlansScreen.js')).toMatch(/item\.type === 'experiencePlanRow'[\s\S]{0,400}navigate\('PlanDetail'/);
    expect(read('screens/PlansScreen.js').match(/navigate\('PlanDetail'/g)).toHaveLength(1);
  });
  test('Gathering and request screens link only to a multi-object parent, never to their own plan', () => {
    for (const f of ['screens/GatheringDetailScreen.js', 'screens/BusinessRequestDetailScreen.js']) {
      const src = read(f);
      expect(src).not.toMatch(/getPlanIdForResource|openPlanDetail|wholePlan|viewTheWholePlan/);
      expect(src).toMatch(/getMultiObjectParent\('(gathering|business_request)'/);
      expect(src).toMatch(/parentPlan && \(\s*<TouchableOpacity onPress=\{\(\) => navigation\.navigate\('PlanDetail', \{ planId: parentPlan\.id \}\)\}/);
    }
  });
  test('Chat no longer has an "Our plan" entry (the match is the chat; Plan together stays)', () => {
    const src = read('screens/ChatScreen.js');
    expect(src).not.toMatch(/ourplan|getPlanIdForMatch|'PlanDetail'/);
    expect(src).toMatch(/key: 'plantogether'/);
  });
  test('no push destination opens PlanDetail', () => {
    expect(read('navigation/notificationDestinations.js')).not.toMatch(/'PlanDetail'/);
  });
});

describe('PlanDetail hands a single-object plan to its own screen', () => {
  const src = read('screens/PlanDetailScreen.js');
  test('it replaces itself before rendering anything', () => {
    expect(src).toMatch(/const destination = canonicalPlanDestination\(ov\);\s*if \(destination\) \{\s*navigation\.replace\(destination\.name, destination\.params\);\s*return;/);
    expect(src).not.toMatch(/isGatheringPlan|isRequestPlan|isMatchPlan|openTheGathering|openTheRequest/);
  });
  test('Back from the object returns where the person was, not to the plan summary', () => {
    const ROUTES = ['MainTabs', 'OldEntry', 'PlanDetail', 'GatheringDetail'];
    const router = StackRouter({});
    const opts = { routeNames: ROUTES, routeParamList: {}, routeGetIdList: {} };
    let s = router.getInitialState(opts);
    s = router.getStateForAction(s, StackActions.push('OldEntry'), opts);
    s = router.getStateForAction(s, StackActions.push('PlanDetail', { planId: 'p' }), opts);
    s = router.getStateForAction(s, StackActions.replace('GatheringDetail', { gatheringId: 'g1' }), opts);
    expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'OldEntry', 'GatheringDetail']);
    s = router.getStateForAction(s, CommonActions.goBack(), opts);
    expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'OldEntry']);
  });
  test('the multi-object plan actions are all still there (stops, date, edit, share, occasion planning)', () => {
    for (const re of [/reorderExperienceStops/, /removeExperienceStop/, /setExperienceNightDate/, /navigateToExperienceStop/, /<ExperienceSharePanel/, /GroupOccasionPlan/, /CelebrateSomething/]) {
      expect(src).toMatch(re);
    }
  });
});
