// Item 15 (owner, 2026-10-10, LOCKED): someone joining while the host has the gathering open is a real event, so the
// Going line updates live and glows once. This decides WHICH reads earn that glow; the stored attendance stays the truth.
//
// A join plays only when ALL hold: the read came from a realtime-triggered reload (`live`; a first read, a focus reload or
// a reopen is the baseline and plays nothing), there was a previous read to compare with, a person approved now was not
// approved before, the server's going count went up (so a failed rows lookup that comes back empty and then full can never
// look like N new joins), and that person's join has not already played on this screen (`shown`; a duplicate realtime
// event re-reads the same rows and plays nothing). Rows are the host's own RLS-visible join rows with blocked people
// already left out, so nothing reaches the host that the host could not already see.
export function approvedIds(rows) {
  return new Set((rows ?? []).filter((r) => r?.status === 'approved' && r.user_id).map((r) => r.user_id));
}

export function newJoinsToAnimate(rows, { previousIds, previousGoing, going, live, shown } = {}) {
  if (!live || !previousIds) return [];
  if (!(Number.isFinite(going) && Number.isFinite(previousGoing) && going > previousGoing)) return [];
  const done = shown ?? new Set();
  return [...approvedIds(rows)].filter((id) => !previousIds.has(id) && !done.has(id));
}
