const fs = require('fs');
const path = require('path');
const { StackRouter, StackActions, CommonActions } = require('@react-navigation/routers');
const { notificationNavAction, identityOf } = require('./notificationNav');

const ROUTES = ['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat', 'BusinessRequestDetail', 'Notices'];

function stackWith(names) {
  const router = StackRouter({});
  const options = { routeNames: ROUTES, routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  for (const [name, params] of names.slice(1)) {
    state = router.getStateForAction(state, StackActions.push(name, params), options);
  }
  return { router, options, state };
}
const top = (s) => s.routes[s.routes.length - 1];

describe('item 139: a push tap opens on top of where the person was', () => {
  const history = [
    ['MainTabs'],
    ['GatheringDetail', { gatheringId: 'A' }],
    ['ViewProfile', { userId: 'u1' }],
    ['Chat', { matchId: 'm1' }],
  ];

  test('the old navigate jumped back to an older copy and lost the history above it (the bug)', () => {
    const { router, options, state } = stackWith(history);
    const after = router.getStateForAction(state, CommonActions.navigate('GatheringDetail', { gatheringId: 'B' }), options);
    expect(after.routes.map((r) => r.name)).toEqual(['MainTabs', 'GatheringDetail']);
  });

  test('the chosen action keeps the history, so Back returns to Chat', () => {
    const { router, options, state } = stackWith(history);
    const params = { gatheringId: 'B' };
    expect(notificationNavAction(top(state), 'GatheringDetail', params)).toBe('push');
    const after = router.getStateForAction(state, StackActions.push('GatheringDetail', params), options);
    expect(after.routes.map((r) => r.name)).toEqual(['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat', 'GatheringDetail']);
    const back = router.getStateForAction(after, StackActions.pop(), options);
    expect(top(back).name).toBe('Chat');
  });

  test('cold start: the stack is just Home, so Back from the offer lands on Home', () => {
    const { state } = stackWith([['MainTabs']]);
    expect(notificationNavAction({ name: 'Home' }, 'BusinessRequestDetail', { requestId: 'r' })).toBe('push');
    expect(state.routes.map((r) => r.name)).toEqual(['MainTabs']);
  });

  test('already looking at that object: refreshed in place, no duplicate', () => {
    const current = { name: 'BusinessRequestDetail', params: { requestId: 'r1', focusOfferId: 'o1' } };
    expect(notificationNavAction(current, 'BusinessRequestDetail', { requestId: 'r1', focusOfferId: 'o2', notificationReason: 'x' })).toBe('setParams');
    expect(notificationNavAction(current, 'BusinessRequestDetail', { requestId: 'r2' })).toBe('push');
    expect(notificationNavAction({ name: 'Notices' }, 'Notices', undefined)).toBe('setParams');
  });

  test('tab destinations stay navigation', () => {
    expect(notificationNavAction({ name: 'Chat' }, 'MainTabs', { screen: 'Home' })).toBe('navigate');
  });

  test('identity = the id params only', () => {
    expect(identityOf({ gatheringId: 1, notificationReason: 'a', openJoin: true })).toBe(identityOf({ gatheringId: '1' }));
    expect(identityOf({ requestId: 'r', focusOfferId: 'o' })).toBe(identityOf({ requestId: 'r' }));
  });
});

describe('item 139 guards', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  test('push taps never call navigationRef.navigate directly', () => {
    const src = read('services/notifications.js');
    const body = src.slice(src.indexOf('export async function routeNotificationTap'), src.indexOf('export async function consumePendingNotificationTap'));
    expect(body).not.toMatch(/navigationRef\.navigate\(/);
    expect(body).toMatch(/openFromTap\(/);
  });
  test('deep links open on top too', () => {
    const src = read('navigation/RootNavigator.js');
    expect(src).toMatch(/getActionFromState: .*linkActionFromState/);
    expect(src).not.toMatch(/navigationRef\.navigate\('(BusinessProfile|BusinessDashboard|GatheringDetail)'/);
  });
});
