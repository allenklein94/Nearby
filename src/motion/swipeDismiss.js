import { useMemo, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';
import { MOTION_BUDGET } from './motionBudget';
import { getReduceMotion } from './motionPolicy';

// Owner item 20 (2026-10-11): animation is decorative, the function is primary. A swipe on something that is
// animating dismisses it at once: no waiting for the animation to finish first. One shared rule, so every surface
// that can be swiped away (the offer arrival pill, an Undo toast, the match modal) decides the same way.
//
// A swipe only claims the gesture after a clear move (so a tap still reaches the buttons inside), follows the finger
// along the allowed directions, and on release either dismisses (far enough or fast enough) or settles back.

import { claimsSwipe, isDismissSwipe } from './swipeDecision';

export { SWIPE_CLAIM_PX, SWIPE_DISMISS_PX, SWIPE_DISMISS_VELOCITY, swipeProgress, claimsSwipe, isDismissSwipe } from './swipeDecision';

// Returns { panHandlers, style } for the swipeable view. onDismiss runs immediately on a dismissing release.
export function useSwipeToDismiss(onDismiss, { directions = ['up'], enabled = true } = {}) {
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const latest = useRef({ onDismiss, directions, enabled });
  latest.current = { onDismiss, directions, enabled };

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => latest.current.enabled && claimsSwipe(g, latest.current.directions),
    onPanResponderMove: (_e, g) => {
      if (getReduceMotion()) return;
      const dirs = latest.current.directions;
      const horizontal = dirs.includes('left') || dirs.includes('right');
      const vertical = dirs.includes('up') || dirs.includes('down');
      translate.setValue({
        x: horizontal ? clampTo(g.dx, dirs.includes('left'), dirs.includes('right')) : 0,
        y: vertical ? clampTo(g.dy, dirs.includes('up'), dirs.includes('down')) : 0,
      });
    },
    onPanResponderRelease: (_e, g) => {
      if (isDismissSwipe(g, latest.current.directions)) {
        latest.current.onDismiss?.();
        return;
      }
      Animated.timing(translate, { toValue: { x: 0, y: 0 }, duration: MOTION_BUDGET.tiny.ms, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => translate.setValue({ x: 0, y: 0 }),
  }), [translate]);

  return {
    panHandlers: responder.panHandlers,
    style: { transform: translate.getTranslateTransform() },
    reset: () => translate.setValue({ x: 0, y: 0 }),
  };
}

function clampTo(v, allowNegative, allowPositive) {
  if (v < 0) return allowNegative ? v : 0;
  return allowPositive ? v : 0;
}
