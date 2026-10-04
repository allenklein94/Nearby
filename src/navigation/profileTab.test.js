// Profile is the fifth bottom tab (owner, 2026-10-04): Home / Discover / Create / Activity / Profile, one job each. A tab
// entry switches to it; a stack screen whose workflow a tab switch would close (Dating Preferences) opens MyProfile, the same
// ProfileScreen presented on top, so Back returns there. Driven through React Navigation's real Stack and Tab routers.
const fs = require('fs');
const path = require('path');
const { StackRouter, TabRouter, StackActions, CommonActions } = require('@react-navigation/routers');
const { PRESENTATION_ROUTES, canonicalRoute } = require('./presentationRoutes');

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const nav = read('navigation/RootNavigator.js');
const TABS = ['Home', 'Discover', 'Create', 'Activity', 'Profile'];

describe('the five tabs', () => {
  test('the tab navigator registers exactly Home, Discover, Create, Activity, Profile, in that order', () => {
    expect([...nav.matchAll(/<Tab\.Screen name="(\w+)"/g)].map((m) => m[1])).toEqual(TABS);
    expect(nav).toMatch(/<Tab\.Screen name="Profile" component=\{ProfileScreen\} \/>/);
  });
  test('every tab has an icon and a label in all 11 languages', () => {
    const icons = nav.slice(nav.indexOf('const TAB_ICONS'), nav.indexOf('};', nav.indexOf('const TAB_ICONS')));
    for (const tab of TABS) expect(icons).toMatch(new RegExp(`\\b${tab}: \\{ active:`));
    const strings = JSON.parse(read('../scripts/i18n/strings/nav.json'));
    expect(Object.keys(strings)).toHaveLength(11);
    for (const [lang, v] of Object.entries(strings)) {
      for (const tab of TABS) expect({ lang, tab, label: typeof v[`tab.${tab.toLowerCase()}`] === 'string' && v[`tab.${tab.toLowerCase()}`].length > 0 }).toEqual({ lang, tab, label: true });
    }
    expect(strings.en['tab.profile']).toBe('Profile');
  });
  test('tabs have no header, so Profile has no back chevron', () => {
    const tabNav = nav.slice(nav.indexOf('<Tab.Navigator'), nav.indexOf('</Tab.Navigator>'));
    expect(tabNav).toMatch(/headerShown: false/);
    expect(tabNav).not.toMatch(/name="Profile"[^>]*options=/);
  });
  test('the header keeps only Messages: no Profile icon, no avatar', () => {
    const h = read('components/TabHeaderActions.js');
    expect(h).toMatch(/navigation\.navigate\('Messages'\)/);
    expect(h).not.toMatch(/navigate\('Profile'\)|getSignedPhotoUrl|header\.profile/);
  });
  test('Plans, Messages, Matches, Settings and Dating Preferences stay stack destinations, not tabs', () => {
    for (const r of ['Plans', 'Messages', 'Matches', 'Settings', 'DatingPreferences']) {
      expect({ r, tab: new RegExp(`<Tab\\.Screen name="${r}"`).test(nav) }).toEqual({ r, tab: false });
    }
    for (const r of ['Plans', 'Messages', 'Settings', 'DatingPreferences']) {
      expect({ r, stack: new RegExp(`<Stack\\.Screen name="${r}"`).test(nav) }).toEqual({ r, stack: true });
    }
  });
});

describe('one Profile surface', () => {
  test('ProfileScreen renders only as the tab and its on-top presentation', () => {
    const uses = [...nav.matchAll(/<(\w+)\.Screen name="(\w+)" component=\{ProfileScreen\}/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(uses.sort()).toEqual(['Stack:MyProfile', 'Tab:Profile']);
    expect(PRESENTATION_ROUTES.MyProfile).toEqual({ surface: 'Profile' });
    expect(canonicalRoute('MyProfile')).toBe('Profile');
    const { SCREEN_REGISTRY } = require('../constants/screenRegistry');
    expect(SCREEN_REGISTRY.Profile.surface).toBe(true);
    expect(SCREEN_REGISTRY.MyProfile).toBeUndefined();
  });
  test('no navigable reference is left to a stack "Profile" route', () => {
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(f);
    });
    walk(SRC);
    const ok = (f) => ['screens/SettingsScreen.js'].includes(path.relative(SRC, f));
    const hits = files.filter((f) => !ok(f) && /(navigate|push)\(\s*'Profile'/.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

// Real routers: a root stack whose first route hosts the tabs.
const stackR = StackRouter({});
const sOpts = { routeNames: ['MainTabs', 'Settings', 'DatingPreferences', 'MyProfile', 'Plans', 'Messages'], routeParamList: {}, routeGetIdList: {} };
const tabR = TabRouter({});
const tOpts = { routeNames: TABS, routeParamList: {}, routeGetIdList: {} };
const names = (s) => s.routes.map((r) => r.name);

describe('Settings -> Profile is a tab switch', () => {
  test('Settings uses the trail-keeping tab navigation with a fresh scroll target each tap', () => {
    const src = read('screens/SettingsScreen.js');
    expect(src.match(/navigateKeepingTrail\(navigation, 'Profile', \{ scrollToInterestsSection: Date\.now\(\) \}\)/g)).toHaveLength(2);
    expect(read('services/openDestination.js')).toMatch(/new Set\(\['Home', 'Discover', 'Create', 'Activity', 'Profile'\]\)/);
  });
  test('focusing the Profile tab closes Settings above the tabs and selects Profile, keeping the other tabs', () => {
    let tabs = tabR.getInitialState(tOpts);
    const homeRoute = tabs.routes[0];
    let root = stackR.getStateForAction(stackR.getInitialState(sOpts), StackActions.push('Settings'), sOpts);
    expect(names(root)).toEqual(['MainTabs', 'Settings']);
    // the tab router handles the navigate; the stack focuses the tab host (React Navigation's route-focus step)
    tabs = tabR.getStateForAction(tabs, CommonActions.navigate('Profile', { scrollToInterestsSection: 1 }), tOpts);
    root = stackR.getStateForRouteFocus(root, root.routes[0].key);
    expect(names(root)).toEqual(['MainTabs']);
    expect(tabs.routes[tabs.index].name).toBe('Profile');
    expect(tabs.routes[tabs.index].params).toEqual({ scrollToInterestsSection: 1 });
    expect(tabs.routes[0]).toBe(homeRoute);
  });
  test('Profile re-scrolls on a second tap (the scroll target is a new value, not the same true)', () => {
    const p = read('screens/ProfileScreen.js');
    expect(p).toMatch(/\}, \[route\?\.params\?\.scrollToInterestsSection\]\);/);
    expect(p).toMatch(/\}, \[route\?\.params\?\.scrollToGenderSection\]\);/);
  });
});

describe('a stack-origin Profile entry presents Profile on top', () => {
  test('Dating Preferences opens MyProfile (both links), never a tab switch', () => {
    const src = read('screens/DatingPreferencesScreen.js');
    expect(src).toMatch(/navigation\.push\('MyProfile'\)/);
    expect(src).toMatch(/navigation\.push\('MyProfile', \{ scrollToGenderSection: Date\.now\(\) \}\)/);
    expect(src).not.toMatch(/navigate\('Profile'/);
  });
  test('Back from MyProfile returns exactly to Dating Preferences', () => {
    let root = stackR.getStateForAction(stackR.getInitialState(sOpts), StackActions.push('DatingPreferences', { draft: 'kept' }), sOpts);
    const origin = root.routes[1];
    root = stackR.getStateForAction(root, StackActions.push('MyProfile', { scrollToGenderSection: 5 }), sOpts);
    expect(names(root)).toEqual(['MainTabs', 'DatingPreferences', 'MyProfile']);
    root = stackR.getStateForAction(root, CommonActions.goBack(), sOpts);
    expect(names(root)).toEqual(['MainTabs', 'DatingPreferences']);
    expect(root.routes[1]).toBe(origin);
  });
  test('the return trail names the presentation "Back to your profile"', () => {
    const { trailLabelKey } = require('./returnTrail');
    expect(trailLabelKey({ routes: [{ name: 'MyProfile' }] })).toBe('ui.returnTrail.myProfile');
  });
});
