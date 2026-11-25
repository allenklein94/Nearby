// Build 87 Tier 1 bug (owner, 2026-11-22): on iOS the header back button ("Main Tabs") was visible but did nothing.
// Root cause: react-native-screens 4.16.0, on iOS 26, turns the back button's touches OFF in
// navigationBar:shouldPopItem: and relies on navigationBar:didPopItem: to turn them back on; when that never reaches the
// button on screen, the back button stays dead (and the flag carries to later screens). 4.17+ removed it; we patch 4.16.0
// the same way (patch-package). Plus: the back label showed the tab container's route name, and Edit Profile's unsaved-changes
// guard used a listener that cannot hold the iOS native back button.
const fs = require('fs');
const path = require('path');
const { mainTabsBackTitle, MAIN_TAB_NAMES } = require('./mainTabsBackTitle');
const { translate } = require('../i18n/translate');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('native back button: react-native-screens patch', () => {
  const pkg = JSON.parse(read('package.json'));
  const patchName = 'patches/react-native-screens+4.16.0.patch';
  test('the patch exists for exactly the installed version, and installs apply it (postinstall patch-package)', () => {
    const pinned = pkg.dependencies['react-native-screens'];
    expect(pinned).toBe('~4.16.0');
    expect(fs.existsSync(path.join(ROOT, patchName))).toBe(true);
    expect(pkg.scripts.postinstall).toBe('patch-package');
    expect(pkg.devDependencies['patch-package']).toBeTruthy();
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.packages['node_modules/react-native-screens'].version).toBe('4.16.0');
    expect(lock.packages['node_modules/patch-package']).toBeTruthy();
  });
  test('it removes only the line that disables the back button, keeping the double-pop guard', () => {
    const patch = read(patchName);
    const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    expect(removed.join('\n')).toMatch(/button\.userInteractionEnabled = false;/);
    expect(added.join('\n')).not.toMatch(/userInteractionEnabled/);
    expect(added.every((l) => /^\+\s*\/\//.test(l))).toBe(true); // only an explanatory comment is added
    expect(patch).toMatch(/ if \(self\.transitionCoordinator == nil\) \{/); // context: the guard itself stays
  });
});

describe('back label = the tab the person came from', () => {
  test('each tab names itself; unknown / not yet known = Home', () => {
    expect(MAIN_TAB_NAMES).toEqual(['Home', 'Discover', 'Create', 'Activity', 'Profile']);
    expect(mainTabsBackTitle('Profile')).toBe('ui.nav.tab.profile');
    expect(mainTabsBackTitle('Activity')).toBe('ui.nav.tab.activity');
    expect(mainTabsBackTitle(undefined)).toBe('ui.nav.tab.home');
    expect(mainTabsBackTitle('MainTabs')).toBe('ui.nav.tab.home');
    for (const tab of MAIN_TAB_NAMES) {
      const word = translate('en', mainTabsBackTitle(tab));
      expect(word).not.toMatch(/^ui\./);
      expect(word).not.toMatch(/MainTabs|Main Tabs/);
    }
    expect(translate('en', mainTabsBackTitle('Profile'))).toBe('Profile');
  });
  test('RootNavigator titles the tab container with it; Edit Profile turns off the multi-pop back menu', () => {
    const nav = read('src/navigation/RootNavigator.js');
    expect(nav).toMatch(/<Stack\.Screen name="MainTabs" component=\{MainTabs\} options=\{\(\{ route \}\) => \(\{ title: t\(mainTabsBackTitle\(getFocusedRouteNameFromRoute\(route\)\)\) \}\)\} \/>/);
    expect(nav).toMatch(/<Stack\.Screen name="EditProfile" component=\{EditProfileScreen\} options=\{\{ headerShown: true, headerBackButtonMenuEnabled: false,/);
  });
});

describe('no screen holds the back button with a plain beforeRemove listener', () => {
  test('beforeRemove listeners cannot stop the iOS native back pop in this native stack: usePreventRemove only', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.js$/.test(f.name) && !/\.test\.js$|\.journey\.js$/.test(f.name) && /addListener\(\s*'beforeRemove'/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
