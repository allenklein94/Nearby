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
  // 20270398: urgent like harassment + underage (one shared urgent cap; first in the admin queue). Needs 0398 live before a
  // build offering it ships: on 0370-0397 the database refuses the value (report_reason_invalid).
  { code: 'unsafe_situation', legacy: 'Unsafe activity or situation', key: 'unsafe', admin: 'Unsafe activity or situation', urgent: true },
  { code: 'fake_profile', legacy: 'Fake profile', key: 'fakeProfile', admin: 'Fake profile' },
  // prioritized in the admin queue (reports.review_priority, 20270381); NOT urgent: the ordinary report cap applies
  { code: 'impersonation', legacy: 'Impersonation', key: 'impersonation', admin: 'Impersonation', priority: true },
  { code: 'spam_scam', legacy: 'Spam or scam', key: 'spam', admin: 'Spam or scam' },
  { code: 'underage_user', legacy: 'Underage user', key: 'underage', admin: 'Underage user', urgent: true },
  { code: 'other', legacy: 'Other', key: 'other', admin: 'Other' },
];

// What a report about a BUSINESS may say (20270381): the sheet offers only these. A business isn't a dating profile and
// can't be underage, so 'fake_profile' and 'underage_user' aren't offered there.
export const BUSINESS_REPORT_CODES = ['unsafe_situation', 'impersonation', 'spam_scam', 'inappropriate_photo', 'harassment', 'other'];
// What a report about a PHOTO may say (a Story or a gathering memory, 20270391): about what it shows.
export const MEDIA_REPORT_CODES = ['inappropriate_photo', 'harassment', 'spam_scam', 'underage_user', 'other'];
// What a report about a GATHERING or COMMUNITY may say (20270392): about what it is, not about a dating profile.
export const OBJECT_REPORT_CODES = ['unsafe_situation', 'spam_scam', 'inappropriate_photo', 'harassment', 'impersonation', 'underage_user', 'other'];
const CODES_BY_TARGET = { business: BUSINESS_REPORT_CODES, media: MEDIA_REPORT_CODES, gathering: OBJECT_REPORT_CODES, community: OBJECT_REPORT_CODES };
export function reportReasonsFor(target) {
  const codes = CODES_BY_TARGET[target];
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

// The admin queue's order (both admin screens), mirroring reports.review_priority (20270398): open first; then urgent
// safety (unsafe situation, harassment, underage user) = 2, impersonation = 1, everything else = 0; OLDEST first within
// each group (the longest-waiting report first). Resolved reports follow, newest first. Keeps a list fetched from an older
// database (no column, or 0381's 1/0 column) in the same order. Ordering only, never a consequence.
export function reportQueuePriority(stored) {
  const code = reportReasonCode(stored);
  const r = REPORT_REASONS.find((x) => x.code === code);
  if (!r) return 0;
  return r.urgent ? 2 : r.priority ? 1 : 0;
}
export function isPriorityReportReason(stored) {
  return reportQueuePriority(stored) === 1;
}
// what the admin card adds after the reason label: ' · Urgent' / ' · Priority' / ''
export function reportQueueTag(stored) {
  const p = reportQueuePriority(stored);
  return p === 2 ? ' · Urgent' : p === 1 ? ' · Priority' : '';
}
export function sortReportQueue(rows) {
  const t = (r) => new Date(r.created_at).getTime();
  const key = (r) => (r.resolved ? [1, 0, -t(r)] : [0, -reportQueuePriority(r.reason), t(r)]);
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

// What a report's server copy is a copy of, in the admin's words (one table: Admin Reports + Admin Review's linked reports).
const REPORTED_WHAT = { match_chat: 'chat (their last messages)', business_offer: 'offer', business: 'business (as it showed then)', story: 'photo', gathering: 'gathering (as it showed then)', community: 'community (as it showed then)' };
export function reportedWhatLabel(contentType) {
  return REPORTED_WHAT[contentType] || 'message';
}
