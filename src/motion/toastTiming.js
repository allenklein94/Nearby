// How long a confirmation toast stays up (pure, so it can be tested without rendering).
const MIN_HOLD_MS = 1800;
const MAX_HOLD_MS = 5000;
const PER_CHAR_MS = 45;
// Long enough to notice the button and reach it; a toast with Undo never goes sooner than this.
export const UNDO_HOLD_MS = 6000;

export function toastHoldMs(title, message, hasUndo = false) {
  const chars = (title?.length ?? 0) + (message?.length ?? 0);
  const read = Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, chars * PER_CHAR_MS));
  return hasUndo ? Math.max(UNDO_HOLD_MS, read) : read;
}
