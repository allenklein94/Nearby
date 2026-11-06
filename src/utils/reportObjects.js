// Admin Reports (20270393): a report about a gathering or community can remove it. ONE rule for the status line, whether Remove is
// offered and whether the reason is long enough. The server decides all of it again: this only keeps the screen truthful.
export const REMOVABLE_REPORT_TYPES = ['gathering', 'community'];
export const REMOVAL_REASON_MIN = 10; // = admin_remove_reported_content
export const REMOVAL_REASON_MAX = 1000;

export function reportObjectIds(rows) {
  return (rows || []).filter((r) => REMOVABLE_REPORT_TYPES.includes(r.content_type)).map((r) => r.id);
}

// Only what the server said is there: no status yet (an older database) offers nothing.
export function canRemoveReportedObject(report, object) {
  return !report?.resolved && REMOVABLE_REPORT_TYPES.includes(report?.content_type) && object?.state === 'live';
}

export function removeActionLabel(contentType) {
  return contentType === 'community' ? 'Remove Community' : 'Remove Gathering';
}

export function removalReasonReady(reason) {
  const length = String(reason || '').trim().length;
  return length >= REMOVAL_REASON_MIN && length <= REMOVAL_REASON_MAX;
}

export function reportObjectStatus(object) {
  if (object?.state === 'removed') {
    const who = object.removed_by_name ? ` by ${object.removed_by_name}` : '';
    const when = object.removed_at ? ` · ${new Date(object.removed_at).toLocaleString()}` : '';
    return `Removed${who}${when}: ${object.reason}`;
  }
  if (object?.state === 'gone') return 'No longer on Nearby';
  return null;
}
