// Admin Reports' legal-hold control (20270395). ONE rule for which hold covers which item, whether a reason is long enough and how a
// hold reads. The server decides everything again (admin_place_legal_hold / admin_release_legal_hold / admin_list_legal_holds:
// admins only, written reason, append-only record, one active hold per item); this only keeps the screen truthful.
// Releasing never deletes anything: the evidence goes back to its ordinary retention, and another active hold still keeps it.
export const LEGAL_HOLD_REASON_MIN = 10; // = admin_place_legal_hold / admin_release_legal_hold
export const LEGAL_HOLD_REASON_MAX = 1000;
export const LEGAL_HOLD_REFERENCE_MAX = 200;

const TARGET_LABEL = { report: 'Report', content_removal: 'Removal record', review_case: 'Review case' };

export function legalHoldReasonReady(reason) {
  const length = String(reason || '').trim().length;
  return length >= LEGAL_HOLD_REASON_MIN && length <= LEGAL_HOLD_REASON_MAX;
}

export function legalHoldReferenceReady(reference) {
  return String(reference || '').trim().length <= LEGAL_HOLD_REFERENCE_MAX;
}

// Active holds only (the server lists active ones unless asked for released), keyed "type:id".
export function activeHoldsByTarget(holds) {
  const map = {};
  for (const h of holds || []) {
    if (h && !h.released_at && h.target_type && h.target_id) map[`${h.target_type}:${h.target_id}`] = h;
  }
  return map;
}

export function holdFor(byTarget, targetType, targetId) {
  return (byTarget || {})[`${targetType}:${targetId}`] || null;
}

export function legalHoldTargetLabel(targetType) {
  return TARGET_LABEL[targetType] || 'Item';
}

export function legalHoldStatusLine(hold) {
  if (!hold) return null;
  const when = hold.placed_at ? ` since ${new Date(hold.placed_at).toLocaleString()}` : '';
  const ref = hold.reference ? ` · Ref ${hold.reference}` : '';
  return `On legal hold${when}${ref}: ${hold.reason}`;
}

// What the place call said about a held photo, in words (null = nothing to add).
export function legalHoldPhotoNote(result) {
  if (result?.photo === 'already_deleted') return "The reported photo was already deleted from Storage and can't be kept.";
  return null;
}
