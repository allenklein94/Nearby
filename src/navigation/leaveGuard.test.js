// Tier 1 fix (build 87, 2026-11-22): Back on Edit Profile did nothing on iPhone. Cause: a beforeRemove listener calling
// preventDefault under native-stack. iOS pops the screen natively first, the JS pop is then refused, the stacks drift
// apart and the confirm dialog never appears. The rule for every screen: ask-before-leaving only through useLeaveGuard
// (usePreventRemove, so iOS cancels the native pop), and that screen's route turns the long-press back menu off.
const fs = require('fs');
const path = require('path');
const routers = require('@react-navigation/routers');

const SRC = path.join(__dirname, '..');
function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = sourceFiles(SRC).map((p) => ({ p: path.relative(SRC, p), s: fs.readFileSync(p, 'utf8') }));
const root = fs.readFileSync(path.join(__dirname, 'RootNavigator.js'), 'utf8');

// Screen file -> the stack routes that render it with a leave guard. A new guarded screen is added here.
const GUARDED_ROUTES = { 'screens/ProfileScreen.js': ['EditProfile'] };

function routeOptions(name) {
  const start = root.indexOf(`<Stack.Screen name="${name}"`);
  expect(start).toBeGreaterThan(-1);
  return root.slice(start, root.indexOf('/>', start));
}

describe('ask-before-leaving never breaks Back', () => {
  test('no screen prevents a leave with a raw beforeRemove listener (unsupported under native-stack)', () => {
    const offenders = files.filter(({ s }) => /addListener\(\s*['"]beforeRemove['"]/.test(s)).map(({ p }) => p);
    expect(offenders).toEqual([]);
  });

  test('usePreventRemove is used only inside the one leave guard', () => {
    const users = files.filter(({ s }) => /usePreventRemove/.test(s)).map(({ p }) => p);
    expect(users).toEqual(['hooks/useLeaveGuard.js']);
  });

  test('every guarded screen is registered here, and its route turns the long-press back menu off', () => {
    const guarded = files.filter(({ p, s }) => p !== 'hooks/useLeaveGuard.js' && /useLeaveGuard\(/.test(s)).map(({ p }) => p);
    expect(guarded.sort()).toEqual(Object.keys(GUARDED_ROUTES).sort());
    for (const routes of Object.values(GUARDED_ROUTES)) {
      for (const r of routes) expect(routeOptions(r)).toMatch(/headerBackButtonMenuEnabled: false/);
    }
  });

  test('the installed native-stack still cancels a native pop for a prevented route (iOS) and pops it in JS', () => {
    const view = fs.readFileSync(require.resolve('@react-navigation/native-stack/src/views/NativeStackView.native.tsx'), 'utf8');
    expect(view).toMatch(/preventNativeDismiss=\{isRemovePrevented\}/);
    expect(view).toMatch(/onNativeDismissCancelled=\{\(event\) => \{\s*navigation\.dispatch\(\{\s*\.\.\.StackActions\.pop/);
    // The re-dispatched action after "Discard changes" skips routes already asked, so it never asks twice.
    const core = fs.readFileSync(require.resolve('@react-navigation/core/src/useOnPreventRemove.tsx'), 'utf8');
    expect(core).toMatch(/visitedRouteKeys\.has\(route\.key\)/);
  });
});

describe('Back from Edit Profile returns to where it was opened from (real routers)', () => {
  const ROOT = ['MainTabs', 'EditProfile', 'Settings'];
  const TABS = ['Home', 'Discover', 'Create', 'Activity', 'Profile'];
  const opts = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });
  const stack = routers.StackRouter({});
  const tabs = routers.TabRouter({});

  function withProfileTab() {
    let state = stack.getInitialState(opts(ROOT));
    let tabState = tabs.getInitialState(opts(TABS));
    tabState = tabs.getStateForAction(tabState, routers.TabActions.jumpTo('Profile'), opts(TABS));
    return { ...state, routes: [{ ...state.routes[0], state: tabState }] };
  }

  test('Profile tab -> Edit Profile -> Back = the Profile tab, still selected', () => {
    let state = withProfileTab();
    state = stack.getStateForAction(state, routers.StackActions.push('EditProfile'), opts(ROOT));
    expect(state.routes.map((r) => r.name)).toEqual(['MainTabs', 'EditProfile']);
    state = stack.getStateForAction(state, routers.StackActions.pop(), opts(ROOT));
    expect(state.routes.map((r) => r.name)).toEqual(['MainTabs']);
    const tab = state.routes[0].state;
    expect(tab.routes[tab.index].name).toBe('Profile');
  });

  test('Settings -> Edit Profile -> Back = Settings', () => {
    let state = withProfileTab();
    state = stack.getStateForAction(state, routers.StackActions.push('Settings'), opts(ROOT));
    state = stack.getStateForAction(state, routers.StackActions.push('EditProfile'), opts(ROOT));
    state = stack.getStateForAction(state, routers.StackActions.pop(), opts(ROOT));
    expect(state.routes.map((r) => r.name)).toEqual(['MainTabs', 'Settings']);
  });
});

describe('the back button names the tab, never the route "MainTabs"', () => {
  test('MainTabs title = the focused tab\'s own label', () => {
    expect(routeOptions('MainTabs')).toMatch(/title: t\(`ui\.nav\.tab\.\$\{lcFirst\(getFocusedRouteNameFromRoute\(route\) \?\? 'Home'\)\}`\)/);
  });
  test('every tab label exists in every language', () => {
    const src = fs.readFileSync(path.join(SRC, 'i18n/ui/nav.js'), 'utf8');
    const blocks = src.split(/\n\s{4}tab: \{/).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(11);
    for (const b of blocks) {
      const block = b.slice(0, b.indexOf('}'));
      for (const k of ['home', 'discover', 'create', 'activity', 'profile']) expect(block).toMatch(new RegExp(`\\b${k}:`));
    }
  });
});
