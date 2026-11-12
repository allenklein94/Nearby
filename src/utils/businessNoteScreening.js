// 20270415 (owner, 2026-11-12): the two short business notes a customer can read go through Nearby's content check first.
// ONE rule for when a note needs the check, mirrored by the database wrappers (set_business_availability_pulse,
// decline_business_offer): only a non-empty note, trimmed; the availability note only when it differs from the one already
// saved (a status tap keeps its note without a new check); the decline note only with the reason "Other".
export const cleanNote = (note) => (typeof note === 'string' ? note.trim() : '') || null;

export function pulseNoteNeedsScreening(note, previousNote) {
  const next = cleanNote(note);
  return next !== null && next !== cleanNote(previousNote);
}

export function declineNoteNeedsScreening(reason, note) {
  return reason === 'other' && cleanNote(note) !== null;
}
