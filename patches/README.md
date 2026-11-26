# Patched dependencies

Applied by `postinstall` (`patch-package --error-on-fail`) on every install: local `npm ci`/`npm install` and EAS builds.
A failed or stale patch stops the install. Guard: `src/navigation/nativeBackPatch.test.js`.

## react-native-screens+4.16.0.patch (Tier 1, 2026-11-22)

On iOS 26, react-native-screens 4.16.0 switches the native back button's touch off when a pop starts
(`navigationBar:shouldPopItem:`) and back on only in `didPopItem`; a pop that ends any other way leaves Back dead,
and the dead button is carried to later screens. Found on build 87 (iOS 26).

This patch is upstream commit 32050b99a37f7d1a4708e99807564a98300aeab8,
"feat(iOS): Handle interactiveContentPopGesture for iOS 26" (software-mansion/react-native-screens PR #3173, released in
4.17.0), restricted to the two files the npm package ships and the commit changes at runtime: `ios/RNSScreen.mm`,
`ios/RNSScreenStack.mm`. Left out: its test app, guide and doc comments in `src/types.tsx` (no runtime effect).
It reverts PRs #3141/#3142 (the back-button lock) and instead blocks a second pop by pausing touches on the window during
a transition (released on every path), and uses iOS 26's own full-screen swipe-back recognizer.
Expo SDK 54 pins ~4.16.0, so the library stays at 4.16.0. Remove this patch when moving to react-native-screens >= 4.17.
