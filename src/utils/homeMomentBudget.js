// Owner idea "207" (2026-10-18, option a): one meaningful animation per Home visit. Home's arrival moments each decide on
// their own whether something new deserves its moment (items 26/34/40/41/53); this only decides which of them may MOVE on
// this visit, so the screen never dances. The rule:
//   - a visit = one stretch of Home being focused (leaving Home and coming back starts a new one);
//   - of the moments that would play, only the highest on the screen plays (HOME_MOMENT_ORDER = Home's fixed top-to-bottom
//     order); once one has played on a visit, every other moment that would play on that visit shows its finished state;
//   - a moment decided once (played or shown finished) keeps that decision: it counts as seen, never replays and never takes
//     a later visit's slot. Each moment still records "seen" through its own store, exactly as before;
//   - no queue, no sequence, no delay: a moment that is not chosen is simply settled from its first frame.
// Exempt (never asked here): the weather card's fade (ambient, item 36), feedback on the person's own taps (Saved, toasts,
// buttons) and the typed-ask results' moments (StrongMatch, understood chips, FoundLine, Nearby Pick: an answer to what the
// person just did). Durations stay motion/motionBudget.js's job; designs, triggers and Reduce Motion are unchanged.
// Pure and React-free; HomeScreen keeps one instance per mount.

// Top to bottom as Home renders them: Picked For You (item 40's friend collision), Your Plans (item 34's Completed), the
// social line (item 41's friends planning), Nearby Right Now (item 26's ring), "N plans this month" (item 53's count roll).
export const HOME_MOMENT_ORDER = ['friendCollision', 'planCompleted', 'friendsPlanning', 'happeningRipple', 'plansThisMonth'];

// Returns decide({ focused, candidates }) -> { [moment]: boolean }. `candidates[moment]` is a stable key for the instance
// that would play now (null/undefined = nothing would). true = this instance may animate.
export function createHomeMomentBudget() {
  const decided = new Map();
  let focused = false;
  let visitHasWinner = false;
  return function decide({ focused: nowFocused, candidates = {} } = {}) {
    if (nowFocused && !focused) visitHasWinner = false; // a new visit
    focused = !!nowFocused;
    const out = {};
    for (const moment of HOME_MOMENT_ORDER) {
      const key = candidates[moment];
      if (key == null || key === '') { out[moment] = false; continue; }
      const id = `${moment}:${key}`;
      if (decided.has(id)) { out[moment] = decided.get(id); continue; }
      // Out of sight nothing is decided, so a moment that arrives while Home is behind another tab keeps its chance.
      if (!focused) { out[moment] = false; continue; }
      const allow = !visitHasWinner;
      if (allow) visitHasWinner = true;
      decided.set(id, allow);
      out[moment] = allow;
    }
    return out;
  };
}
