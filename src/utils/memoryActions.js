// What a person may do with one gathering memory (20270391). The server decides again on every action; this only picks what to
// show. Your own: Remove. Someone else's: Report, plus Remove when you host the gathering. Nothing without a known viewer.
export function memoryActions(memory, myUserId, isHost = false) {
  if (!memory || !myUserId) return { remove: null, report: false };
  if (memory.user_id === myUserId) return { remove: 'own', report: false };
  return { remove: isHost ? 'host' : null, report: true };
}
