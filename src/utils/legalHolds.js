// Admin Reports' legal-hold control (20270395). ONE rule for which hold covers which item, whether a reason is long enough and how a
// hold reads. The server decides everything again (admin_place_legal_hold / admin_release_legal_hold / admin_list_legal_holds:
// admins only, written reason, append-only record, one active hold per item); this only keeps the screen truthful.
// Releasing never deletes anything: live records go back to their ordinary retention, what was kept from a deleted account waits for a
// recorded retention policy (20270402), and another active hold still keeps it.
export const LEGAL_HOLD_REASON_MIN = 10; // = admin_place_legal_hold / admin_release_legal_hold
export const LEGAL_HOLD_REASON_MAX = 1000;
export const LEGAL_HOLD_REFERENCE_MAX = 200;
// 20270402: a hold keeps what it is about. The whole moderation history only when the admin says so, recorded on the hold.
export const LEGAL_HOLD_HISTORY_LABEL = "Also keep this account's whole moderation history if it is deleted (only if the matter requires it)";

const TARGET_LABEL = { report: 'Report', content_removal: 'Removal record', review_case: 'Review case', id_submission: 'ID submission' };  // id_submission: 20270400

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
  const scope = hold.scope === 'account_history' ? ' · Whole account history' : '';
  return `On legal hold${when}${ref}${scope}: ${hold.reason}`;
}

// What the place call said about a held photo, in words (null = nothing to add).
export function legalHoldPhotoNote(result) {
  if (result?.photo === 'already_deleted') return "The reported photo was already deleted from Storage and can't be kept.";
  // 20270400: the deletion job had already sent the DELETE (it can't be recalled), so the file is probably gone soon
  if (result?.photo === 'deleting') return "Its deletion from Storage was already under way and can't be stopped, so the file may not be kept.";
  // 20270402: the account's original files named by this hold
  if (result?.files?.deleting > 0) return `${result.files.deleting} original file(s) were already being deleted and may not be kept.`;
  if (result?.files?.already_deleted > 0) return `${result.files.already_deleted} original file(s) were already deleted and can't be kept.`;
  return null;
}
