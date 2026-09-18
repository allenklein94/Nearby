import { AccessibilityInfo } from 'react-native';

// Item 127 ("Respect Reduce Motion"): the ONE shared place Nearby reads and enforces the OS-level
// Reduce Motion setting. Two layers, so a future animation is covered even if its author forgets:
//
//   1. A single module-level store (`getReduceMotion` / `subscribeReduceMotion`) -- one
//      AccessibilityInfo subscription for the whole app instead of one per mounted component;
//      `src/hooks/useReduceMotion.js` is now a thin hook over it.
//   2. `installReducedMotionPolicy(Animated)` -- patched once at app start (App.js). While Reduce
//      Motion is on, every `Animated.spring` degrades to an instant (0ms) timing -- no bounce,
//      no overshoot, the value simply lands -- and every `Animated.loop` is a no-op that never
//      starts -- no pulsing/sweeping/perpetual motion. Plain `Animated.timing` fades are left
//      alone: a short opacity crossfade is the sanctioned reduced-motion substitute. The check is
//      made at call time, so toggling the OS setting takes effect on the very next animation.
//
// Components still branch on `useReduceMotion()` where the reduced state is DIFFERENT CONTENT
// (skip a multi-stage morph, omit a particle burst, hold a slide-in offset at zero); the policy
// only guarantees the mechanical rules (no springs, no loops) everywhere else.

let reduceMotion = false;
let initialized = false;
const listeners = new Set();

function setReduceMotion(next) {
  const value = !!next;
  if (value === reduceMotion) return;
  reduceMotion = value;
  listeners.forEach((l) => l(reduceMotion));
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  try {
    if (typeof AccessibilityInfo?.isReduceMotionEnabled === 'function') {
      AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    }
    AccessibilityInfo?.addEventListener?.('reduceMotionChanged', setReduceMotion);
  } catch {
    // Fails safe: motion allowed, never accidentally suppressed for someone who didn't ask.
  }
}

export function getReduceMotion() {
  ensureInitialized();
  return reduceMotion;
}

export function subscribeReduceMotion(listener) {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Test seam.
export function __setReduceMotionForTests(value) {
  initialized = true;
  setReduceMotion(value);
}

// A no-op stand-in for Animated.loop's return value while Reduce Motion is on. Carries the
// internal hooks Animated.parallel/sequence call on their children so it composes safely.
export function createInertAnimation() {
  return {
    start(callback) { callback?.({ finished: true }); },
    stop() {},
    reset() {},
    _startNativeLoop() {},
    _isUsingNativeDriver() { return false; },
  };
}

let installed = false;

export function installReducedMotionPolicy(Animated) {
  if (installed || !Animated) return;
  installed = true;
  ensureInitialized();

  const originalSpring = Animated.spring;
  const originalLoop = Animated.loop;

  Animated.spring = (value, config = {}) => {
    if (!getReduceMotion()) return originalSpring(value, config);
    return Animated.timing(value, {
      toValue: config.toValue,
      duration: 0,
      useNativeDriver: config.useNativeDriver,
    });
  };

  Animated.loop = (animation, config) => {
    if (!getReduceMotion()) return originalLoop(animation, config);
    return createInertAnimation();
  };
}

// Item 137: one place decides how a native <Modal> transitions. Screens pass their intended type
// (`animationType={modalAnimation('slide')}`); under Reduce Motion a slide becomes a plain fade.
// Read at render time, so the next open after the OS setting changes picks it up.
export function modalAnimation(type = 'slide') {
  if (type === 'none') return 'none';
  return getReduceMotion() ? 'fade' : type;
}

// Item 137: one place decides how a layout change (an accordion expanding) animates. Small-tier
// ease (220ms, matching MOTION_BUDGET.small) instead of RN's 300ms preset; under Reduce Motion the
// layout simply snaps. Call immediately before the setState that changes the layout.
export function animateLayout() {
  if (getReduceMotion()) return;
  const { LayoutAnimation } = require('react-native');
  LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}
