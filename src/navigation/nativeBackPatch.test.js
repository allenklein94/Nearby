// Tier 1 (build 87, iOS 26, 2026-11-22): react-native-screens 4.16.0 switched the native back button's touch off when a
// pop started and back on only in didPopItem, so Back could stay dead on every later screen. Fixed by upstream commit
// 32050b99a (PR #3173, released in 4.17.0), applied to 4.16.0 by patch-package on every install (patches/README.md).
// These checks read the INSTALLED native sources, so they fail on an install where the patch did not apply.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PATCH = path.join(ROOT, 'patches/react-native-screens+4.16.0.patch');
const RNS = path.dirname(require.resolve('react-native-screens/package.json'));
const read = (rel) => fs.readFileSync(path.join(RNS, rel), 'utf8');

describe('react-native-screens iOS 26 back-button fix', () => {
  test('every install applies the patches, and a patch that no longer applies stops the install', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.postinstall).toBe('patch-package --error-on-fail');
    expect(pkg.devDependencies['patch-package']).toBeDefined();
  });

  test('the patch is for the installed version (moving to >= 4.17 means deleting the patch, it is upstream there)', () => {
    expect(require('react-native-screens/package.json').version).toBe('4.16.0');
    expect(fs.existsSync(PATCH)).toBe(true);
  });

  test('the patch changes only the two native files of upstream commit 32050b99a (no unrelated library changes)', () => {
    const patch = fs.readFileSync(PATCH, 'utf8');
    const files = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
    expect(files).toEqual([
      'node_modules/react-native-screens/ios/RNSScreen.mm',
      'node_modules/react-native-screens/ios/RNSScreenStack.mm',
    ]);
    expect((patch.match(/^@@/gm) || []).length).toBe(18); // 6 + 12 hunks, as upstream
  });

  test('installed stack: the back-button lock is gone, iOS 26 swipe-back uses the native recognizer', () => {
    const stack = read('ios/RNSScreenStack.mm');
    expect(stack).not.toMatch(/shouldPopItem/);
    expect(stack).not.toMatch(/didPopItem/);
    expect(stack).not.toMatch(/button\.userInteractionEnabled = false/);
    expect(stack).toMatch(/_controller\.interactiveContentPopGestureRecognizer\.delegate = self;/);
  });

  test('installed screen: the transition-time touch pause is released on every path', () => {
    const screen = read('ios/RNSScreen.mm');
    expect(screen).toMatch(/- \(void\)willMoveToWindow:\(UIWindow \*\)newWindow/);
    expect(screen).toMatch(/newWindow\.userInteractionEnabled = false;/);
    // released when the screen appears, when a dismiss is cancelled, and when a dismiss finishes
    expect(screen).toMatch(/self\.view\.window\.userInteractionEnabled = true;/);
    expect(screen).toMatch(/presentationController\.containerView\.window\.userInteractionEnabled = true;/);
    expect(screen).toMatch(/presentationController\.presentingViewController\.view\.window\.userInteractionEnabled = true;/);
  });
});
