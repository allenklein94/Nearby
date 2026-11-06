// Report reasons (owner 2026-10-31, migration 20270370): one table for the app, mirroring private.report_reason_code.
const fs = require('fs');
const path = require('path');
const { REPORT_REASONS, SYSTEM_REPORT_REASONS, reportReasonCode, reportReasonLabel, isUrgentReportReason, isPriorityReportReason, reportReasonsFor, sortReportQueue, BUSINESS_REPORT_CODES, OBJECT_REPORT_CODES } = require('./reportReasons');
const reportBlock = require('../i18n/ui/reportBlock').default;

const ROOT = path.join(__dirname, '..', '..');
// the mapping as it stands now = 20270381's (impersonation added); 0370's own mapping + rollback keep the original six
const migration0370 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270370_report_reason_codes.sql'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270381_impersonation_and_business_reports.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270370_report_reason_codes.rollback.sql'), 'utf8');
const rollback0381 = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270381_impersonation_and_business_reports.rollback.sql'), 'utf8');
const ALL = [...REPORT_REASONS, ...SYSTEM_REPORT_REASONS];

describe('report reasons', () => {
  test('seven reasons for people (Impersonation separate, 20270381), two urgent; impersonation prioritized, NOT urgent', () => {
    expect(REPORT_REASONS.map((r) => r.code)).toEqual(['inappropriate_photo', 'harassment', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user', 'other']);
    expect(REPORT_REASONS.filter((r) => r.urgent).map((r) => r.code)).toEqual(['harassment', 'underage_user']);
    expect(REPORT_REASONS.filter((r) => r.priority).map((r) => r.code)).toEqual(['impersonation']);
    expect(isUrgentReportReason('impersonation')).toBe(false);
    expect(isUrgentReportReason('Impersonation')).toBe(false);
    expect(isPriorityReportReason('Impersonation')).toBe(true);
    expect(isPriorityReportReason('fake_profile')).toBe(false);
  });

  test('a business report offers business reasons only (no Fake profile, no Underage user)', () => {
    expect(reportReasonsFor('business').map((r) => r.code)).toEqual(BUSINESS_REPORT_CODES);
    expect(BUSINESS_REPORT_CODES).toEqual(['impersonation', 'spam_scam', 'inappropriate_photo', 'harassment', 'other']);
    expect(reportReasonsFor('gathering').map((r) => r.code)).toEqual(OBJECT_REPORT_CODES);
    expect(reportReasonsFor('community').map((r) => r.code)).toEqual(OBJECT_REPORT_CODES);
    expect(reportReasonsFor('gathering').every(Boolean)).toBe(true);
    expect(reportReasonsFor('person')).toBe(REPORT_REASONS);
    expect(reportReasonsFor(undefined)).toBe(REPORT_REASONS);
  });

  test('admin queue order: open first, then impersonation, then newest; resolved never jumps ahead', () => {
    const rows = [
      { id: 'old-imp', reason: 'impersonation', created_at: '2026-10-01T00:00:00Z' },
      { id: 'new-spam', reason: 'spam_scam', created_at: '2026-11-01T00:00:00Z' },
      { id: 'resolved-imp', reason: 'impersonation', resolved: true, created_at: '2026-11-01T01:00:00Z' },
      { id: 'legacy-imp', reason: 'Impersonation', created_at: '2026-10-15T00:00:00Z' },
      { id: 'old-spam', reason: 'Spam or scam', created_at: '2026-09-01T00:00:00Z' },
    ];
    expect(sortReportQueue(rows).map((r) => r.id)).toEqual(['legacy-imp', 'old-imp', 'new-spam', 'old-spam', 'resolved-imp']);
    expect(sortReportQueue(null)).toEqual([]);
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

  test('the legacy values are exactly what build 87 and older save (unchanged English values) + Impersonation', () => {
    expect(REPORT_REASONS.map((r) => r.legacy)).toEqual(['Inappropriate photo', 'Harassment or abuse', 'Fake profile', 'Impersonation', 'Spam or scam', 'Underage user', 'Other']);
  });

  test('parity with the migration: same codes, same legacy values, same urgent pair, same constraint', () => {
    for (const r of ALL) {
      expect(migration).toContain(`when p = '${r.legacy.replace(/'/g, "''")}' then '${r.code}'`);
      if (r.code === 'impersonation') {
        // 0381's rollback keeps it as fake_profile, its original reason in details; 0370's rollback then runs as before
        expect(migration0370).not.toContain("'impersonation'");
        expect(rollback0381).toContain("set reason = 'fake_profile',\n       details = 'Original reason: Impersonation'");
      } else {
        expect(migration0370).toContain(`when p = '${r.legacy.replace(/'/g, "''")}' then '${r.code}'`);
        expect(rollback).toContain(`when reason = '${r.code}' then '${r.legacy.replace(/'/g, "''")}'`);
      }
    }
    const codeList = (re) => (re.exec(migration)?.[1] || '').match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1)).sort();
    const codes = ALL.map((r) => r.code).sort();
    expect(codeList(/when p in \(([^)]*)\) then p/)).toEqual(codes);
    expect(codeList(/reports_reason_code_check check \(reason in \(([^)]*)\)/)).toEqual(codes);
    // the urgent rule stays 0370's (0381 doesn't touch it): impersonation never bypasses the ordinary cap
    expect(migration0370).toMatch(/report_reason_code\(p\) in \('harassment', 'underage_user'\)/);
    expect(migration).not.toMatch(/is_urgent_report_reason/);
    expect(migration).toMatch(/generated always as \(case when reason = 'impersonation' then 1 else 0 end\) stored/);
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
    expect(isUrgentReportReason('fake_profile')).toBe(false);
    expect(isUrgentReportReason('auto_possible_minor')).toBe(false);
    expect(isUrgentReportReason('Acoso o abuso')).toBe(false);
  });

  test('admin label for codes, old English rows, and unknown text', () => {
    expect(reportReasonLabel('fake_profile')).toBe('Fake profile');
    expect(reportReasonLabel('Fake profile')).toBe('Fake profile');
    expect(reportReasonLabel('impersonation')).toBe('Impersonation');
    expect(reportReasonLabel('underage_user')).toBe('Underage user');
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
