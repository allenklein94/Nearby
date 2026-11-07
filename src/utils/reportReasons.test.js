// Report reasons (owner 2026-10-31, migration 20270370): one table for the app, mirroring private.report_reason_code.
const fs = require('fs');
const path = require('path');
const { REPORT_REASONS, SYSTEM_REPORT_REASONS, reportReasonCode, reportReasonLabel, isUrgentReportReason, isPriorityReportReason, reportReasonsFor, sortReportQueue, reportQueuePriority, reportQueueTag, BUSINESS_REPORT_CODES, OBJECT_REPORT_CODES, MEDIA_REPORT_CODES } = require('./reportReasons');
const reportBlock = require('../i18n/ui/reportBlock').default;

const ROOT = path.join(__dirname, '..', '..');
// the mapping as it stands now = 20270398's (unsafe_situation added); 0381 added impersonation; 0370's own mapping +
// rollback keep the original six
const migration0370 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270370_report_reason_codes.sql'), 'utf8');
const migration0381 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270381_impersonation_and_business_reports.sql'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270398_unsafe_report_reason.sql'), 'utf8');
const rollback0398 = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270398_unsafe_report_reason.rollback.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270370_report_reason_codes.rollback.sql'), 'utf8');
const rollback0381 = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270381_impersonation_and_business_reports.rollback.sql'), 'utf8');
const ALL = [...REPORT_REASONS, ...SYSTEM_REPORT_REASONS];

describe('report reasons', () => {
  test('eight reasons for people; three urgent (one shared cap); impersonation prioritized, NOT urgent (20270398)', () => {
    expect(REPORT_REASONS.map((r) => r.code)).toEqual(['inappropriate_photo', 'harassment', 'unsafe_situation', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user', 'other']);
    expect(REPORT_REASONS.filter((r) => r.urgent).map((r) => r.code)).toEqual(['harassment', 'unsafe_situation', 'underage_user']);
    expect(REPORT_REASONS.filter((r) => r.priority).map((r) => r.code)).toEqual(['impersonation']);
    expect(isUrgentReportReason('unsafe_situation')).toBe(true);
    expect(isUrgentReportReason('Unsafe activity or situation')).toBe(true);
    expect(isUrgentReportReason('impersonation')).toBe(false);
    expect(isUrgentReportReason('Impersonation')).toBe(false);
    expect(isPriorityReportReason('Impersonation')).toBe(true);
    expect(isPriorityReportReason('harassment')).toBe(false);
    expect(isPriorityReportReason('fake_profile')).toBe(false);
    expect(['unsafe_situation', 'harassment', 'Underage user', 'impersonation', 'spam_scam', 'nonsense'].map(reportQueuePriority)).toEqual([2, 2, 2, 1, 0, 0]);
    expect(['unsafe_situation', 'impersonation', 'other'].map(reportQueueTag)).toEqual([' · Urgent', ' · Priority', '']);
  });

  test('where Unsafe activity or situation is offered: people, messages, offers, gatherings, communities, businesses; not photos', () => {
    expect(reportReasonsFor('business').map((r) => r.code)).toEqual(BUSINESS_REPORT_CODES);
    expect(BUSINESS_REPORT_CODES).toEqual(['unsafe_situation', 'impersonation', 'spam_scam', 'inappropriate_photo', 'harassment', 'other']);
    expect(OBJECT_REPORT_CODES).toEqual(['unsafe_situation', 'spam_scam', 'inappropriate_photo', 'harassment', 'impersonation', 'underage_user', 'other']);
    expect(reportReasonsFor('gathering').map((r) => r.code)).toEqual(OBJECT_REPORT_CODES);
    expect(reportReasonsFor('community').map((r) => r.code)).toEqual(OBJECT_REPORT_CODES);
    expect(reportReasonsFor('gathering').every(Boolean)).toBe(true);
    expect(reportReasonsFor('business').every(Boolean)).toBe(true);
    // people, messages and offers (BusinessRequestDetail's ⋯ Report this offer) use the full list
    expect(reportReasonsFor('person')).toBe(REPORT_REASONS);
    expect(reportReasonsFor(undefined)).toBe(REPORT_REASONS);
    expect(MEDIA_REPORT_CODES).not.toContain('unsafe_situation');
    const offerScreen = fs.readFileSync(path.join(ROOT, 'src/screens/BusinessRequestDetailScreen.js'), 'utf8');
    const offerSheet = offerScreen.slice(offerScreen.indexOf("type: 'business_offer'") - 400, offerScreen.indexOf("type: 'business_offer'") + 200);
    expect(offerSheet).toContain('<ReportBlockModal');
    expect(offerSheet).not.toMatch(/target=/);
  });

  test('admin queue order: open first; urgent safety, then impersonation, then the rest; oldest first in each; resolved last, newest first', () => {
    const rows = [
      { id: 'new-unsafe', reason: 'unsafe_situation', created_at: '2026-11-05T00:00:00Z' },
      { id: 'old-harass', reason: 'Harassment or abuse', created_at: '2026-10-20T00:00:00Z' },
      { id: 'old-imp', reason: 'impersonation', created_at: '2026-10-01T00:00:00Z' },
      { id: 'new-spam', reason: 'spam_scam', created_at: '2026-11-01T00:00:00Z' },
      { id: 'resolved-unsafe-new', reason: 'unsafe_situation', resolved: true, created_at: '2026-11-06T01:00:00Z' },
      { id: 'resolved-imp-old', reason: 'impersonation', resolved: true, created_at: '2026-11-01T01:00:00Z' },
      { id: 'legacy-imp', reason: 'Impersonation', created_at: '2026-10-15T00:00:00Z' },
      { id: 'old-spam', reason: 'Spam or scam', created_at: '2026-09-01T00:00:00Z' },
      { id: 'underage', reason: 'underage_user', created_at: '2026-10-25T00:00:00Z' },
    ];
    expect(sortReportQueue(rows).map((r) => r.id)).toEqual(['old-harass', 'underage', 'new-unsafe', 'old-imp', 'legacy-imp', 'old-spam', 'new-spam', 'resolved-unsafe-new', 'resolved-imp-old']);
    expect(sortReportQueue(null)).toEqual([]);
    // both admin screens ask the server for the same order (review_priority, then oldest)
    for (const f of ['src/screens/AdminReportsScreen.js', 'src/screens/AdminReviewScreen.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src).toContain("query.order('review_priority', { ascending: false })");
      expect(src).toMatch(/order\('created_at', \{ ascending: byPriority \}\)/);
      expect(src).toContain('reportQueueTag(');
    }
  });

  test('every code and every legacy value maps to its code; anything else to nothing', () => {
    for (const r of ALL) {
      expect(reportReasonCode(r.code)).toBe(r.code);
      expect(reportReasonCode(r.legacy)).toBe(r.code);
    }
    for (const bad of ['', null, undefined, 'Spam', 'harassment ', 'Acoso o abuso', 'Fake profile or impersonation']) {
      expect(reportReasonCode(bad)).toBeNull();
    }
  });

  test('the legacy values are exactly what build 87 and older save (unchanged English values) + Impersonation + Unsafe', () => {
    expect(REPORT_REASONS.map((r) => r.legacy)).toEqual(['Inappropriate photo', 'Harassment or abuse', 'Unsafe activity or situation', 'Fake profile', 'Impersonation', 'Spam or scam', 'Underage user', 'Other']);
  });

  test('parity with the migration: same codes, same legacy values, same urgent three, same constraint, same queue priority', () => {
    for (const r of ALL) {
      expect(migration).toContain(`when p = '${r.legacy.replace(/'/g, "''")}' then '${r.code}'`);
      if (r.code === 'unsafe_situation') {
        // 0398's rollback keeps it as 'other', its original reason in details; earlier rollbacks then run as before
        expect(migration0381).not.toContain("'unsafe_situation'");
        expect(rollback0398).toContain("set reason = 'other',\n       details = 'Original reason: Unsafe activity or situation'");
      } else if (r.code === 'impersonation') {
        // 0381's rollback keeps it as fake_profile, its original reason in details; 0370's rollback then runs as before
        expect(migration0370).not.toContain("'impersonation'");
        expect(rollback0381).toContain("set reason = 'fake_profile',\n       details = 'Original reason: Impersonation'");
      } else {
        expect(migration0370).toContain(`when p = '${r.legacy.replace(/'/g, "''")}' then '${r.code}'`);
        expect(rollback).toContain(`when reason = '${r.code}' then '${r.legacy.replace(/'/g, "''")}'`);
      }
    }
    const codeList = (re, src = migration) => (re.exec(src)?.[1] || '').match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1)).sort();
    const codes = ALL.map((r) => r.code).sort();
    expect(codeList(/when p in \(([^)]*)\) then p/)).toEqual(codes);
    expect(codeList(/reports_reason_code_check check \(reason in \(([^)]*)\)/)).toEqual(codes);
    // the urgent rule names exactly the app's urgent reasons; one shared cap ('urgent_report' counts them all)
    expect(codeList(/report_reason_code\(p\) in \(([^)]*)\)/)).toEqual(REPORT_REASONS.filter((r) => r.urgent).map((r) => r.code).sort());
    expect(codeList(/when reason in \(([^)]*)\) then 2/)).toEqual(REPORT_REASONS.filter((r) => r.urgent).map((r) => r.code).sort());
    expect(migration).toMatch(/when reason = 'impersonation' then 1\s+else 0 end\) stored/);
    // the rollback restores 0381's column + 0370's urgent pair verbatim
    expect(rollback0398).toContain("generated always as (case when reason = 'impersonation' then 1 else 0 end) stored");
    expect(rollback0398).toMatch(/report_reason_code\(p\) in \('harassment', 'underage_user'\)/);
  });

  test('the system sources send exactly their legacy values (sponsored + the live moderate-photo strings)', () => {
    const sponsored = fs.readFileSync(path.join(ROOT, 'src/services/sponsored.js'), 'utf8');
    const photo = fs.readFileSync(path.join(ROOT, 'supabase/functions/moderate-photo/index.ts'), 'utf8');
    expect(sponsored).toContain("reason: 'Sponsored content'");
    for (const r of SYSTEM_REPORT_REASONS.filter((x) => x.automated)) expect(photo).toContain(`'${r.legacy}'`);
  });

  test('urgent by code or by legacy value, never otherwise', () => {
    expect(isUrgentReportReason('harassment')).toBe(true);
    expect(isUrgentReportReason('Underage user')).toBe(true);
    expect(isUrgentReportReason('Actividad o situación peligrosa')).toBe(false);
    expect(isUrgentReportReason('fake_profile')).toBe(false);
    expect(isUrgentReportReason('auto_possible_minor')).toBe(false);
    expect(isUrgentReportReason('Acoso o abuso')).toBe(false);
  });

  test('admin label for codes, old English rows, and unknown text', () => {
    expect(reportReasonLabel('fake_profile')).toBe('Fake profile');
    expect(reportReasonLabel('Fake profile')).toBe('Fake profile');
    expect(reportReasonLabel('impersonation')).toBe('Impersonation');
    expect(reportReasonLabel('underage_user')).toBe('Underage user');
    expect(reportReasonLabel('unsafe_situation')).toBe('Unsafe activity or situation');
    // display only (owner 2026-10-31): the label covers messages and posts too; code + legacy value unchanged
    expect(reportReasonLabel('inappropriate_photo')).toBe('Inappropriate content');
    expect(reportReasonLabel('Inappropriate photo')).toBe('Inappropriate content');
    expect(reportReasonLabel('Something from long ago')).toBe('Something from long ago');
    expect(reportReasonLabel(null)).toBe('');
  });

  test('the sheet saves the fixed value, never a translation; every chip label exists in all 11 languages', () => {
    const sheet = fs.readFileSync(path.join(ROOT, 'src/components/ReportBlockModal.js'), 'utf8');
    expect(sheet).toContain('reportReasonsFor(target).map((r) => ({ value: r.legacy, key: r.key }))');
    const langs = Object.keys(reportBlock);
    expect(langs).toHaveLength(11);
    for (const lang of langs) for (const r of REPORT_REASONS) expect(reportBlock[lang].reason[r.key]).toEqual(expect.any(String));
    expect(reportBlock.en.reason.fakeProfile).toBe('Fake profile');
    expect(reportBlock.en.reason.impersonation).toBe('Impersonation');
    expect(reportBlock.en.reason.unsafe).toBe('Unsafe activity or situation');
    for (const lang of langs.filter((l) => l !== 'en')) expect(reportBlock[lang].reason.unsafe).not.toBe(reportBlock.en.reason.unsafe);
    for (const lang of langs) {
      expect(reportBlock[lang].reportBusiness).toEqual(expect.any(String));
      expect(reportBlock[lang].reportBusinessTitle).toContain('{name}');
    }
    expect(reportBlock.en.reason.inappropriatePhoto).toBe('Inappropriate content');
    for (const lang of langs.filter((l) => l !== 'en')) expect(reportBlock[lang].reason.inappropriatePhoto).not.toBe(reportBlock.en.reason.inappropriatePhoto);
    for (const lang of langs.filter((l) => l !== 'en')) expect(reportBlock[lang].reason.fakeProfile).not.toBe(reportBlock.en.reason.fakeProfile);
    for (const lang of langs.filter((l) => l !== 'en')) expect(reportBlock[lang].reason.impersonation).not.toBe(reportBlock.en.reason.impersonation);
  });
});
