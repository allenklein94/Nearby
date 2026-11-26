// What a held leave attempt does (hooks/useLeaveGuard.js holds it): right after a deliberate leave (a save) continue at once;
// otherwise ask, Keep editing = stay with everything as typed, Discard = continue the original navigation.
export function leaveGuardResponse({ allowLeave, action, confirm, proceed }) {
  if (allowLeave) {
    proceed(action);
    return 'left';
  }
  confirm({
    onKeepEditing: () => {},
    onDiscard: () => proceed(action),
  });
  return 'asked';
}
