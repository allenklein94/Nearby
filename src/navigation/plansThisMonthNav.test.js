// Item 53's "N plans this month" card (owner 2026-10-24): opens Plans on Past (where the counted plans are, idea "397"), and Back
// returns to the same mounted Home with its state untouched. Driven through the real React Navigation routers (root StackRouter +
// TabRouter), the same way returnTrail.test.js drives them.
const fs = require('fs');
const path = require('path');
const routers = require('@react-navigation/routers');

const ROOT = ['MainTabs', 'Plans', 'GatheringDetail'];
const TABS = ['Home', 'Discover', 'Create', 'Activity', 'Profile'];
const opts = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });

const home = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
const plans = fs.readFileSync(path.join(__dirname, '../screens/PlansScreen.js'), 'utf8');

// The card's own navigate call, read from HomeScreen (so the test fails if the card changes).
function cardNavigateCall() {
  const card = home.slice(home.indexOf('showPlansThisMonth(plansMonth?.count) &&'));
  const m = card.match(/onPress=\{\(\) => navigation\.navigate\('(\w+)', (\{[^}]*\})\)\}/);
  // eslint-disable-next-line no-new-func
  return { screen: m[1], params: new Function(`return ${m[2]}`)() };
}

describe('Home "plans this month" card -> Plans, Past tab; Back restores Home', () => {
  test('the card opens Plans with initialTab past, and its link names that place', () => {
    expect(cardNavigateCall()).toEqual({ screen: 'Plans', params: { initialTab: 'past' } });
    const start = home.indexOf('showPlansThisMonth(plansMonth?.count) &&');
    const card = home.slice(start, home.indexOf('styles.browseButton', start));
    expect(card).toMatch(/t\('ui\.home\.seePastPlans'\)/);
    expect(card).not.toMatch(/Momentum|viewActivity/);
  });

  test('Plans selects the tab it is opened with', () => {
    expect(plans).toMatch(/useState\(route\?\.params\?\.initialTab \?\? 'upcoming'\)/);
  });

  test('through the real routers: Plans on top with Past, Back = the same Home route, params and tab untouched', () => {
    const stack = routers.StackRouter({});
    const tabs = routers.TabRouter({});
    let state = stack.getInitialState(opts(ROOT));
    // Home with some screen state of its own (stands in for its scroll / ask / filters, which live in the mounted screen)
    const tabState = tabs.getInitialState(opts(TABS));
    tabState.routes[0] = { ...tabState.routes[0], params: { ask: 'coffee tonight' } };
    state.routes[0] = { ...state.routes[0], state: tabState };
    const before = state.routes[0];

    const { screen, params } = cardNavigateCall();
    state = stack.getStateForAction(state, routers.CommonActions.navigate(screen, params), opts(ROOT));
    const top = state.routes[state.index];
    expect(top.name).toBe('Plans');
    expect(top.params).toEqual({ initialTab: 'past' });
    expect(state.routes[0]).toBe(before); // Home stays mounted underneath, unchanged

    state = stack.getStateForAction(state, routers.StackActions.pop(), opts(ROOT));
    expect(state.index).toBe(0);
    const host = state.routes[0];
    expect(host).toBe(before);
    expect(host.state.routes[host.state.index].name).toBe('Home');
    expect(host.state.routes[host.state.index].params).toEqual({ ask: 'coffee tonight' });
  });
});
