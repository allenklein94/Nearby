// Report reasons (owner 2026-10-31, migration 20270370): one table for the app, mirroring private.report_reason_code.
const fs = require('fs');
const path = require('path');
const { REPORT_REASONS, SYSTEM_REPORT_REASONS, reportReasonCode, reportReasonLabel, isUrgentReportReason } = require('./reportReasons');
const reportBlock = require('../i18n/ui/reportBlock').default;

const ROOT = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270370_report_reason_codes.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270370_report_reason_codes.rollback.sql'), 'utf8');
const ALL = [...REPORT_REASONS, ...SYSTEM_REPORT_REASONS];

describe('report reasons', () => {
  test('six reasons for people, Underage user kept, two urgent: harassment + underage user', () => {
    expect(REPORT_REASONS.map((r) => r.code)).toEqual(['inappropriate_photo', 'harassment', 'fake_profile', 'spam_scam', 'underage_user', 'other']);
    expect(REPORT_REASONS.filter((r) => r.urgent).map((r) => r.code)).toEqual(['harassment', 'underage_user']);
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

  test('the legacy values are exactly what build 87 and older save (unchanged English values)', () => {
    expect(REPORT_REASONS.map((r) => r.legacy)).toEqual(['Inappropriate photo', 'Harassment or abuse', 'Fake profile', 'Spam or scam', 'Underage user', 'Other']);
  });

  test('parity with the migration: same codes, same legacy values, same urgent pair, same constraint', () => {
    for (const r of ALL) {
      expect(migration).toContain(`when p = '${r.legacy.replace(/'/g, "''")}' then '${r.code}'`);
      expect(rollback).toContain(`when reason = '${r.code}' then '${r.legacy.replace(/'/g, "''")}'`);
    }
    const codeList = (re) => (re.exec(migration)?.[1] || '').match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1)).sort();
    const codes = ALL.map((r) => r.code).sort();
    expect(codeList(/when p in \(([^)]*)\) then p/)).toEqual(codes);
    expect(codeList(/reports_reason_code_check check \(reason in \(([^)]*)\)/)).toEqual(codes);
    expect(migration).toMatch(/report_reason_code\(p\) in \('harassment', 'underage_user'\)/);
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
    expect(reportReasonLabel('fake_profile')).toBe('Fake profile or impersonation');
    expect(reportReasonLabel('Fake profile')).toBe('Fake profile or impersonation');
    expect(reportReasonLabel('underage_user')).toBe('Underage user');
    // display only (owner 2026-10-31): the label covers messages and posts too; code + legacy value unchanged
    expect(reportReasonLabel('inappropriate_photo')).toBe('Inappropriate content');
    expect(reportReasonLabel('Inappropriate photo')).toBe('Inappropriate content');
    expect(reportReasonLabel('Something from long ago')).toBe('Something from long ago');
    expect(reportReasonLabel(null)).toBe('');
  });

  test('the sheet saves the fixed value, never a translation; every chip label exists in all 11 languages', () => {
    const sheet = fs.readFileSync(path.join(ROOT, 'src/components/ReportBlockModal.js'), 'utf8');
    expect(sheet).toContain('REPORT_REASONS.map((r) => ({ value: r.legacy, key: r.key }))');
    const langs = Object.keys(reportBlock);
    expect(langs).toHaveLength(11);
    for (const lang of langs) for (const r of REPORT_REASONS) expect(reportBlock[lang].reason[r.key]).toEqual(expect.any(String));
    expect(reportBlock.en.reason.fakeProfile).toBe('Fake profile or impersonation');
    expect(reportBlock.en.reason.inappropriatePhoto).toBe('Inappropriate content');
    for (const lang of langs.filter((l) => l !== 'en')) expect(reportBlock[lang].reason.inappropriatePhoto).not.toBe(reportBlock.en.reason.inappropriatePhoto);
    for (const lang of langs.filter((l) => l !== 'en')) expect(reportBlock[lang].reason.fakeProfile).not.toBe(reportBlock.en.reason.fakeProfile);
  });
});
