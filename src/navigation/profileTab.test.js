// Profile is the fifth bottom tab (owner, 2026-10-04): Home / Discover / Create / Activity / Profile, one job each. Profile is
// a destination (item 35, 2026-10-08): editing it is its own stack screen, EditProfile, opened from the tab, Settings and
// Dating Preferences, so Back returns to where the person was. Driven through React Navigation's real Stack and Tab routers.
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

describe('one Profile surface, one edit screen', () => {
  test('ProfileScreen renders only as the tab; EditProfile renders it in edit mode', () => {
    const uses = [...nav.matchAll(/<(\w+)\.Screen name="(\w+)" component=\{(ProfileScreen|EditProfileScreen)\}/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
    expect(uses.sort()).toEqual(['Stack:EditProfile:EditProfileScreen', 'Tab:Profile:ProfileScreen']);
    expect(read('screens/EditProfileScreen.js')).toMatch(/<ProfileScreen \{\.\.\.props\} mode="edit" \/>/);
    expect(PRESENTATION_ROUTES.MyProfile).toBeUndefined();
    const { SCREEN_REGISTRY, RULE14_DECISIONS } = require('../constants/screenRegistry');
    expect(SCREEN_REGISTRY.Profile.surface).toBe(true);
    expect(SCREEN_REGISTRY.EditProfile.jobs).toEqual(['C']);
    expect(RULE14_DECISIONS.removed).toContain('MyProfile');
  });
  test('the summary holds no edit form; the form renders only in edit mode', () => {
    const p = read('screens/ProfileScreen.js');
    const summary = p.slice(p.indexOf('{!editing && ('), p.indexOf('{editing && ('));
    const edit = p.slice(p.indexOf('{editing && ('), p.indexOf('</ScrollView>'));
    for (const field of ['onPress={changePhoto}', 'onPress={save}', 'onPress={openAddPrompt}', 'onChangeText={setBio}']) {
      expect({ field, inSummary: summary.includes(field) }).toEqual({ field, inSummary: false });
    }
    expect(edit).toMatch(/onPress=\{save\}/);
    expect(edit).toMatch(/onPress=\{changePhoto\}/);
    // Edit Profile, Complete profile and the interests link all open the edit screen; nothing scrolls the tab to a form
    expect(summary.match(/navigation\.navigate\('EditProfile'/g)).toHaveLength(3);
    expect(summary).not.toMatch(/editSectionYRef/);
  });
  test('the summary reads: you, interests, friends, gatherings, ..., business, settings', () => {
    const p = read('screens/ProfileScreen.js');
    const summary = p.slice(p.indexOf('{!editing && ('), p.indexOf('{editing && ('));
    const at = (k) => summary.indexOf(k);
    const order = ['snapshotCard', "ui.profile.myInterests", "ui.profile.yourConnections", "ui.profile.yourPlans", "ui.profile.business')", "ui.nav.title.settings"].map(at);
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  test('saving on Edit Profile returns to where the person came from; the tab re-reads on focus', () => {
    const p = read('screens/ProfileScreen.js');
    expect(p).toMatch(/if \(editing && navigation\.canGoBack\?\.\(\)\) \{\n      allowLeaveRef\.current = true;\n      navigation\.goBack\(\);/);
    expect(p).toMatch(/editing \? null : navigation\.addListener\?\.\('focus', load\)/);
  });
  test('no navigable reference is left to a stack "Profile" route', () => {
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(f);
    });
    walk(SRC);
    const ok = () => false;
    const hits = files.filter((f) => !ok(f) && /(navigate|push)\(\s*'Profile'/.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

// Real routers: a root stack whose first route hosts the tabs.
const stackR = StackRouter({});
const sOpts = { routeNames: ['MainTabs', 'Settings', 'DatingPreferences', 'EditProfile', 'Plans', 'Messages'], routeParamList: {}, routeGetIdList: {} };
const tabR = TabRouter({});
const tOpts = { routeNames: TABS, routeParamList: {}, routeGetIdList: {} };
const names = (s) => s.routes.map((r) => r.name);

describe('every edit entry pushes Edit Profile on top', () => {
  test('Settings and Dating Preferences push EditProfile with a fresh scroll target, never a tab switch', () => {
    const settings = read('screens/SettingsScreen.js');
    expect(settings.match(/navigation\.push\('EditProfile', \{ scrollToInterestsSection: Date\.now\(\) \}\)/g)).toHaveLength(2);
    expect(settings).not.toMatch(/'Profile', \{ scrollTo/);
    const dp = read('screens/DatingPreferencesScreen.js');
    expect(dp).toMatch(/navigation\.push\('EditProfile', \{ scrollToInterestsSection: Date\.now\(\) \}\)/);
    expect(dp).toMatch(/navigation\.push\('EditProfile', \{ scrollToGenderSection: Date\.now\(\) \}\)/);
    expect(dp).not.toMatch(/navigate\('Profile'|'MyProfile'/);
  });
  test('Edit Profile re-scrolls on a second tap (the scroll target is a new value, not the same true)', () => {
    const p = read('screens/ProfileScreen.js');
    expect(p).toMatch(/\}, \[route\?\.params\?\.scrollToInterestsSection\]\);/);
    expect(p).toMatch(/\}, \[route\?\.params\?\.scrollToGenderSection\]\);/);
  });
  test('Back from Edit Profile returns exactly to the screen that opened it', () => {
    for (const origin of ['Settings', 'DatingPreferences']) {
      let root = stackR.getStateForAction(stackR.getInitialState(sOpts), StackActions.push(origin, { draft: 'kept' }), sOpts);
      const before = root.routes[1];
      root = stackR.getStateForAction(root, StackActions.push('EditProfile', { scrollToGenderSection: 5 }), sOpts);
      expect(names(root)).toEqual(['MainTabs', origin, 'EditProfile']);
      root = stackR.getStateForAction(root, CommonActions.goBack(), sOpts);
      expect(names(root)).toEqual(['MainTabs', origin]);
      expect(root.routes[1]).toBe(before);
    }
  });
  test('the return trail names Edit Profile "Back to your profile"', () => {
    const { trailLabelKey } = require('./returnTrail');
    expect(trailLabelKey({ routes: [{ name: 'EditProfile' }] })).toBe('ui.returnTrail.myProfile');
  });
});
