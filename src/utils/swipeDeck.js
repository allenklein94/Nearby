// The ONE swipe-deck controller (owner, 2026-10-17: a swipe must be as reliable as the deck's buttons), shared by Dating's
// SwipeableDiscoveryCards and Friends' FriendDiscoverySwipeCards. Pure (no React Native), so its behavior is unit-tested.
//
// The defect it replaces: each deck built its PanResponder once (useRef) and that handler closed over the FIRST render's
// `data` / `currentIndex` / callbacks, so every swipe after the first acted on the first card again (a second Notice /
// Pass to the same person) and the deck stopped advancing; the buttons, created each render, were right. Here the gesture
// handler and the buttons call the same long-lived controller, which reads the CURRENT items and callbacks (`sync` runs on
// every render), so what is acted on is always the person visible when the gesture completes.
//
// Rules:
// - The visible person = the first item, in order, that has not been decided this deck session (`gone`).
// - `swipe(dir)` takes that person at that moment; while one card is flying off, any further swipe or button tap is
//   ignored (never queued, never applied to the next person); the pan handler also declines to start (`isBusy`).
// - When the fly-off ends the person is marked gone (the deck advances) and `onDecide(item, dir)` runs. If it reports
//   failure (returns / resolves to `false`, or throws) the person is restored: they are visible again, never silently
//   skipped. Anything else (undefined/true) is success.
// - Left = skip/pass; the last left-decided person can be brought back with `rewind()` (Dating's ↺); a right clears it.

export const SWIPE_DIRECTIONS = { right: 'right', left: 'left' };

// Release past the threshold either way decides; anything shorter springs back (null).
export function releaseDirection(dx, threshold) {
  if (dx > threshold) return SWIPE_DIRECTIONS.right;
  if (dx < -threshold) return SWIPE_DIRECTIONS.left;
  return null;
}

export function createSwipeDeck({ keyOf = (item) => item.id, animateOut, resetPosition = () => {}, onBegin = () => {}, onChange = () => {} } = {}) {
  let items = [];
  let onDecide = () => {};
  let onAdvanced = null;
  const gone = new Set();
  let busy = null; // { key, item, dir } while a card is flying off
  let lastSkipped = null;

  const visibleItems = () => items.filter((item) => !gone.has(keyOf(item)));

  function restore(key) {
    if (!gone.delete(key)) return;
    if (lastSkipped === key) lastSkipped = null;
    onChange();
  }

  async function settle(item, dir) {
    let ok;
    try {
      ok = await onDecide(item, dir);
    } catch (e) {
      ok = false;
    }
    if (ok === false) restore(keyOf(item));
  }

  function finish() {
    const { key, item, dir } = busy;
    busy = null;
    gone.add(key);
    lastSkipped = dir === SWIPE_DIRECTIONS.left ? key : null;
    resetPosition();
    onChange();
    if (onAdvanced) onAdvanced(visibleItems().length);
    return settle(item, dir);
  }

  return {
    sync(next) {
      items = next.items ?? [];
      if (next.onDecide) onDecide = next.onDecide;
      onAdvanced = next.onAdvanced ?? null;
    },
    visible: () => visibleItems()[0] ?? null,
    next: () => visibleItems()[1] ?? null,
    remaining: () => visibleItems().length,
    isBusy: () => busy !== null,
    canRewind: () => lastSkipped !== null && gone.has(lastSkipped),
    // Starts deciding the visible person; false when nothing happened (no one visible, or a card already in flight).
    swipe(dir) {
      if (busy) return false;
      const item = visibleItems()[0];
      if (!item) return false;
      busy = { key: keyOf(item), item, dir };
      onBegin(dir);
      animateOut(dir, finish);
      return true;
    },
    rewind() {
      if (busy || lastSkipped === null) return false;
      const key = lastSkipped;
      lastSkipped = null;
      gone.delete(key);
      onChange();
      return true;
    },
    restore,
  };
}
