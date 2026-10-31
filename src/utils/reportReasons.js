// Report reasons (owner, 2026-10-31; migration 20270370). ONE table for the app: each reason has a stable code (what the
// database stores and every rule reads), the English value older builds send (`legacy`, still accepted forever: the
// database maps it to the code on insert), the translated chip label (ui.reportBlock.reason.<key>) and the admin label.
// Translations only ever label a reason; they never reach the database or a rule. Mirrors private.report_reason_code
// (parity guard: reportReasons.test.js reads the migration).
//
// The report sheet still SENDS `legacy`: it works on every database state (today's prod has no codes, and between the
// staged 0356 and 0370 a code would miss 0356's urgent rule). Switch the sheet to `code` once 0370 is live.
export const REPORT_REASONS = [
  { code: 'inappropriate_photo', legacy: 'Inappropriate photo', key: 'inappropriatePhoto', admin: 'Inappropriate photo' },
  { code: 'harassment', legacy: 'Harassment or abuse', key: 'harassment', admin: 'Harassment or abuse', urgent: true },
  { code: 'fake_profile', legacy: 'Fake profile', key: 'fakeProfile', admin: 'Fake profile or impersonation' },
  { code: 'spam_scam', legacy: 'Spam or scam', key: 'spam', admin: 'Spam or scam' },
  { code: 'underage_user', legacy: 'Underage user', key: 'underage', admin: 'Underage user', urgent: true },
  { code: 'other', legacy: 'Other', key: 'other', admin: 'Other' },
];

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

export function isUrgentReportReason(stored) {
  const code = reportReasonCode(stored);
  return REPORT_REASONS.some((x) => x.code === code && x.urgent);
}
