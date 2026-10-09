// The "You're booked" card's lifetime (motion/BookedCelebration.js), kept pure so it can be tested without rendering:
// enter -> hold -> exit (fade + slight shrink, then the space it took closes smoothly) -> done (the screen removes it).
// The card owns this, so the screen never pulls it out abruptly (that was the layout jump). Runs ONCE per mount: a
// re-render, a refreshed booking or a second success call never replays it. Reduce Motion: the settled card is shown,
// held, then removed at once with no exit animation. After stop() (unmount) nothing runs and done is never called.
export function createBookedLifecycle({ reduceMotion = false, holdMs, enter, exit, onDone, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let started = false;
  let stopped = false;
  let finished = false;
  let timer = null;

  const finish = () => {
    if (stopped || finished) return;
    finished = true;
    if (onDone) onDone();
  };

  return {
    start() {
      if (started || stopped) return false;
      started = true;
      if (reduceMotion) {
        timer = setTimer(() => { timer = null; finish(); }, holdMs);
        return true;
      }
      enter(() => {
        if (stopped) return;
        timer = setTimer(() => {
          timer = null;
          if (stopped) return;
          exit(finish);
        }, holdMs);
      });
      return true;
    },
    stop() {
      stopped = true;
      if (timer) { clearTimer(timer); timer = null; }
    },
    isFinished: () => finished,
  };
}
