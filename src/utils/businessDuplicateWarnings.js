// Duplicate business details / identical business images for the admin application review (20270414, owner idea 36).
// The ONE reading of admin_business_duplicate_warnings() rows. A warning is evidence for a human, never a judgment: it never
// rejects, blocks or delays an approval, it only asks the admin to look first. Admin screens only; no applicant or business
// ever sees these rows (the server refuses anyone but an admin).

const FIELD = { phone: 'phone number', email: 'email address', website: 'website' };
const STATUS = {
  pending: 'pending application',
  needs_info: 'application waiting for more info',
  approved: 'approved business',
  denied: 'declined application',
  active: 'business',
  inactive: 'inactive business',
};
const MEDIA = { logo: 'logo', offer_photo: 'offer photo' };

function mediaWords(list) {
  const kinds = String(list ?? '').split(',').map((k) => MEDIA[k]).filter(Boolean);
  return kinds.length ? kinds.join(' and ') : 'image';
}

// One line per row, e.g. 'Same phone number as "Joe\'s Cafe" (approved business).'
export function duplicateWarningLine(row) {
  if (!row) return '';
  const name = row.other_name ? `"${row.other_name}"` : 'another business';
  const status = STATUS[row.other_status] ?? 'application';
  if (row.match_kind === 'media') {
    return `Its ${mediaWords(row.subject_media)} is the exact same image as the ${mediaWords(row.other_media)} of ${name} (${status}).`;
  }
  const field = FIELD[row.match_kind];
  if (!field) return '';
  const who = row.same_account ? ', sent from this same account' : '';
  return `Same ${field} as ${name} (${status}${who}).`;
}

// Rows about one application card (contact kinds) or one business (media), undismissed first.
export function warningsFor(rows, subjectType, subjectId) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.subject_type === subjectType && r.subject_id === subjectId && duplicateWarningLine(r))
    .sort((a, b) => Number(Boolean(a.dismissed)) - Number(Boolean(b.dismissed)));
}

export function activeWarnings(rows, subjectType, subjectId) {
  return warningsFor(rows, subjectType, subjectId).filter((r) => !r.dismissed);
}

// Approve asks "Approve anyway?" only while an undismissed warning exists; approval itself is never refused.
export function approvalNeedsConfirm(rows, requestId) {
  return activeWarnings(rows, 'application', requestId).length > 0;
}

// Media pairs appear once in the top list (the server returns both directions).
export function mediaMatchPairs(rows) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.match_kind !== 'media' || !r.other_partner_id) continue;
    const key = [r.subject_id, r.other_partner_id].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => Number(Boolean(a.dismissed)) - Number(Boolean(b.dismissed)));
}

// The ids admin_dismiss_business_duplicate takes for a row.
export function dismissArgs(row, reason) {
  return {
    p_kind: row.match_kind,
    p_subject: row.subject_id,
    p_other: row.match_kind === 'media' ? row.other_partner_id : row.other_request_id,
    p_reason: String(reason ?? '').trim(),
  };
}

export const DISMISS_REASON_MIN = 10;
