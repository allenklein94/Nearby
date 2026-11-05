// Report reasons (owner, 2026-10-31; migration 20270370; 'impersonation' split from 'fake_profile', owner 2026-11-01,
// migration 20270381). ONE table for the app: each reason has a stable code (what the
// database stores and every rule reads), the English value older builds send (`legacy`, still accepted forever: the
// database maps it to the code on insert), the translated chip label (ui.reportBlock.reason.<key>) and the admin label.
// Translations only ever label a reason; they never reach the database or a rule. Mirrors private.report_reason_code
// (parity guard: reportReasons.test.js reads the migration).
//
// The report sheet still SENDS `legacy`: it works on every database state (today's prod has no codes, and between the
// staged 0356 and 0370 a code would miss 0356's urgent rule). Switch the sheet to `code` once 0370 is live.
export const REPORT_REASONS = [
  { code: 'inappropriate_photo', legacy: 'Inappropriate photo', key: 'inappropriatePhoto', admin: 'Inappropriate content' },
  { code: 'harassment', legacy: 'Harassment or abuse', key: 'harassment', admin: 'Harassment or abuse', urgent: true },
  { code: 'fake_profile', legacy: 'Fake profile', key: 'fakeProfile', admin: 'Fake profile' },
  // prioritized in the admin queue (reports.review_priority, 20270381); NOT urgent: the ordinary report cap applies
  { code: 'impersonation', legacy: 'Impersonation', key: 'impersonation', admin: 'Impersonation', priority: true },
  { code: 'spam_scam', legacy: 'Spam or scam', key: 'spam', admin: 'Spam or scam' },
  { code: 'underage_user', legacy: 'Underage user', key: 'underage', admin: 'Underage user', urgent: true },
  { code: 'other', legacy: 'Other', key: 'other', admin: 'Other' },
];

// What a report about a BUSINESS may say (20270381): the sheet offers only these. A business isn't a dating profile and
// can't be underage, so 'fake_profile' and 'underage_user' aren't offered there.
export const BUSINESS_REPORT_CODES = ['impersonation', 'spam_scam', 'inappropriate_photo', 'harassment', 'other'];
// What a report about a PHOTO may say (a Story or a gathering memory, 20270391): about what it shows.
export const MEDIA_REPORT_CODES = ['inappropriate_photo', 'harassment', 'spam_scam', 'underage_user', 'other'];
export function reportReasonsFor(target) {
  const codes = target === 'business' ? BUSINESS_REPORT_CODES : target === 'media' ? MEDIA_REPORT_CODES : null;
  return codes ? codes.map((c) => REPORT_REASONS.find((r) => r.code === c)) : REPORT_REASONS;
}

// Written by the system, never offered in the sheet: "Report this ad" (services/sponsored.js) and moderate-photo's
// automated flags (its live strings, exactly). Clients can't file the automated ones (database refuses).
export const SYSTEM_REPORT_REASONS = [
  { code: 'sponsored_content', legacy: 'Sponsored content', admin: 'Sponsored content' },
  { code: 'auto_photo_failed', legacy: 'Automated: photo failed content moderation', admin: 'Automated: photo failed content moderation', automated: true },
  { code: 'auto_possible_minor', legacy: 'Automated: possible minor detected in profile photo', admin: 'Automated: possible minor detected in profile photo', automated: true },
  { code: 'auto_age_check_failed', legacy: 'Automated: age-verification check failed to complete, treated as unverified', admin: 'Automated: age-verification check failed, treated as unverified', automated: true },
];

const ALL = [...REPORT_REASONS, ...SYSTEM_REPORT_REASONS];

// code or legacy value -> code; anything else -> null (the database refuses it)
export function reportReasonCode(stored) {
  const r = ALL.find((x) => x.code === stored || x.legacy === stored);
  return r ? r.code : null;
}

// what the admin screens show for a stored reason (old rows and old databases included); unknown text is shown as is
export function reportReasonLabel(stored) {
  const r = ALL.find((x) => x.code === stored || x.legacy === stored);
  return r ? r.admin : String(stored ?? '');
}

// The admin queue's order (both admin screens): open first, then prioritized reasons (impersonation), then newest. The
// server orders by reports.review_priority the same way; this keeps a list fetched from an older database (no column)
// in the same order. Ordering only, never a consequence.
export function isPriorityReportReason(stored) {
  const code = reportReasonCode(stored);
  return REPORT_REASONS.some((x) => x.code === code && x.priority);
}
export function sortReportQueue(rows) {
  const key = (r) => [r.resolved ? 1 : 0, isPriorityReportReason(r.reason) ? 0 : 1, -new Date(r.created_at).getTime()];
  return [...(rows || [])].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
}

export function isUrgentReportReason(stored) {
  const code = reportReasonCode(stored);
  return REPORT_REASONS.some((x) => x.code === code && x.urgent);
}
