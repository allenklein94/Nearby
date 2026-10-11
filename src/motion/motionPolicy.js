import { AccessibilityInfo, AppState } from 'react-native';
import { AMBIENT } from './motionBudget';

// Item 127 ("Respect Reduce Motion"): the ONE shared place Nearby reads and enforces the OS-level
// Reduce Motion setting. Two layers, so a future animation is covered even if its author forgets:
//
//   1. A single module-level store (`getReduceMotion` / `subscribeReduceMotion`) -- one
//      AccessibilityInfo subscription for the whole app instead of one per mounted component;
//      `src/hooks/useReduceMotion.js` is now a thin hook over it.
//   (Item 22 adds a third rule here: every loop is governed -- capped and paused in the background; see governLoop.)
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

// Owner item 22 (2026-10-11, battery): every ambient loop is governed. It stops for good after AMBIENT.maxLoopMs of running
// time (a loader still on screen then holds its static state; it was never information, the caption is), and it pauses
// while the app is in the background, resuming with the time it had left. Delegates the internal hooks so it still composes
// inside Animated.parallel/sequence. A pause/resume never calls the owner's start callback; only the real end does.
const liveLoops = new Set();
let appStateWatched = false;

function watchAppState() {
  if (appStateWatched) return;
  appStateWatched = true;
  try {
    AppState?.addEventListener?.('change', (next) => {
      const active = next === 'active';
      [...liveLoops].forEach((l) => (active ? l._resume() : l._pause()));
    });
  } catch {
    // No AppState (tests, web without it): loops are still capped.
  }
}

export function governLoop(inner, { maxMs = AMBIENT.maxLoopMs, schedule = setTimeout, cancel = clearTimeout, now = () => Date.now() } = {}) {
  let state = 'idle'; // idle | running | paused | halting | done
  let remaining = maxMs;
  let startedAt = 0;
  let timer = null;
  let ownerCallback = null;
  const clear = () => { if (timer != null) cancel(timer); timer = null; };
  const finish = (result) => {
    clear();
    state = 'done';
    liveLoops.delete(governed);
    const cb = ownerCallback;
    ownerCallback = null;
    cb?.(result);
  };
  const run = () => {
    state = 'running';
    startedAt = now();
    timer = schedule(() => { timer = null; state = 'halting'; inner.stop(); finish({ finished: true }); }, remaining);
    inner.start((result) => { if (state === 'running') finish(result); });
  };
  const governed = {
    start(callback) {
      if (state === 'running' || state === 'paused') return;
      ownerCallback = callback ?? null;
      remaining = maxMs;
      liveLoops.add(governed);
      watchAppState();
      if (state === 'done') inner.reset?.();
      run();
    },
    stop() {
      if (state === 'idle' || state === 'done') { inner.stop(); return; }
      const wasRunning = state === 'running';
      state = 'halting';
      if (wasRunning) inner.stop();
      finish({ finished: false });
    },
    reset() {
      clear();
      liveLoops.delete(governed);
      state = 'idle';
      ownerCallback = null;
      inner.reset?.();
    },
    _pause() {
      if (state !== 'running') return;
      clear();
      remaining = Math.max(0, remaining - (now() - startedAt));
      state = 'paused'; // before stop(): the inner end callback must not count as the real end
      inner.stop();
    },
    _resume() {
      if (state !== 'paused') return;
      if (remaining <= 0) { finish({ finished: true }); return; }
      inner.reset?.();
      run();
    },
    _startNativeLoop(...args) { return inner._startNativeLoop?.(...args); },
    _isUsingNativeDriver() { return !!inner._isUsingNativeDriver?.(); },
  };
  return governed;
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
    if (!getReduceMotion()) return governLoop(originalLoop(animation, config));
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
