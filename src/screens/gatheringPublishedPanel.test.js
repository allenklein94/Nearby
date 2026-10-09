// Screen-reduction audit B5 (2026-10-09): publishing lands on the gathering, with a one-time "Your gathering is live"
// panel at the top, instead of a separate confirmation screen. Driven partly through React Navigation's real Stack router.
const fs = require('fs');
const path = require('path');
const { StackRouter, StackActions, CommonActions } = require('@react-navigation/routers');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the GatheringConfirmation route and screen are gone from both navigators', () => {
  for (const nav of ['navigation/RootNavigator.js', 'navigation/BusinessWebNavigator.js']) expect(read(nav)).not.toMatch(/name="GatheringConfirmation"|GatheringConfirmationScreen/);
  expect(fs.existsSync(path.join(__dirname, 'GatheringConfirmationScreen.js'))).toBe(false);
});

test('Create replaces itself with the gathering and hands over what the panel says', () => {
  const src = read('screens/CreateGatheringScreen.js');
  expect(src).toMatch(/navigation\.replace\('GatheringDetail', \{\s*gatheringId: created\.id,\s*justPublished: \{ placeName, businessesAsked: askLocalBusinesses, preInviteResult \},/);
});

test('GatheringDetail shows the panel only to the host, once, and Done just closes it', () => {
  const src = read('screens/GatheringDetailScreen.js');
  expect(src).toMatch(/\{justPublished && gathering\.isHost && \(\s*<GatheringPublishedPanel/);
  expect(src).toMatch(/onDone=\{\(\) => navigation\.setParams\(\{ justPublished: undefined \}\)\}/);
  const panel = read('components/GatheringPublishedPanel.js');
  expect(panel).toMatch(/function handleDone\(\) \{\s*onDone\?\.\(\);\s*\}/);
  expect(panel).not.toMatch(/navigation\.replace/);
  for (const re of [/handleShare/, /handleOpenInvite/, /handleInviteCircle/, /weInvited/, /wellLookForLocalBusiness/]) expect(panel).toMatch(re);
});

test('Back from the published gathering returns where Create was started from', () => {
  const ROUTES = ['MainTabs', 'Plans', 'CreateGathering', 'GatheringDetail'];
  const router = StackRouter({});
  const opts = { routeNames: ROUTES, routeParamList: {}, routeGetIdList: {} };
  let s = router.getInitialState(opts);
  s = router.getStateForAction(s, StackActions.push('Plans'), opts);
  s = router.getStateForAction(s, StackActions.push('CreateGathering'), opts);
  s = router.getStateForAction(s, StackActions.replace('GatheringDetail', { gatheringId: 'g', justPublished: {} }), opts);
  expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'Plans', 'GatheringDetail']);
  s = router.getStateForAction(s, CommonActions.goBack(), opts);
  expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'Plans']);
});
