const fs = require('fs');
const path = require('path');
const {
  LEGAL_HOLD_REASON_MIN, LEGAL_HOLD_REASON_MAX, LEGAL_HOLD_REFERENCE_MAX, activeHoldsByTarget, holdFor, legalHoldPhotoNote,
  legalHoldReasonReady, legalHoldReferenceReady, legalHoldStatusLine, legalHoldTargetLabel,
} = require('./legalHolds');

const ROOT = path.join(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270395_legal_holds.sql'), 'utf8');
const SCREEN = fs.readFileSync(path.join(ROOT, 'src/screens/AdminReportsScreen.js'), 'utf8');

describe('legal-hold control in Admin Reports (20270395)', () => {
  test('reason limits match the server', () => {
    expect(MIGRATION).toMatch(new RegExp(`between ${LEGAL_HOLD_REASON_MIN} and ${LEGAL_HOLD_REASON_MAX}`));
    expect(MIGRATION).toMatch(new RegExp(`length\\(v_ref\\) > ${LEGAL_HOLD_REFERENCE_MAX}`));
    expect(legalHoldReasonReady('short')).toBe(false);
    expect(legalHoldReasonReady('   padded    ')).toBe(false);
    expect(legalHoldReasonReady('Preservation request #12')).toBe(true);
    expect(legalHoldReasonReady('x'.repeat(1001))).toBe(false);
    expect(legalHoldReferenceReady('')).toBe(true);
    expect(legalHoldReferenceReady('x'.repeat(201))).toBe(false);
  });

  test('only active holds count, matched by type and id', () => {
    const map = activeHoldsByTarget([
      { hold_id: 'h1', target_type: 'report', target_id: 'r1', reason: 'kept for a request', placed_at: '2026-11-07T10:00:00Z' },
      { hold_id: 'h2', target_type: 'report', target_id: 'r2', released_at: '2026-11-07T11:00:00Z' },
      { hold_id: 'h3', target_type: 'review_case', target_id: 'r1' },
    ]);
    expect(holdFor(map, 'report', 'r1').hold_id).toBe('h1');
    expect(holdFor(map, 'report', 'r2')).toBeNull();
    expect(holdFor(map, 'review_case', 'r1').hold_id).toBe('h3');
    expect(holdFor(map, 'content_removal', 'r1')).toBeNull();
    expect(activeHoldsByTarget(null)).toEqual({});
  });

  test('status line says it is held, why, and the reference; nothing when not held', () => {
    const line = legalHoldStatusLine({ reason: 'Police preservation request', reference: 'PR-7', placed_at: '2026-11-07T10:00:00Z' });
    expect(line).toMatch(/^On legal hold since /);
    expect(line).toMatch(/Ref PR-7: Police preservation request$/);
    expect(legalHoldStatusLine(null)).toBeNull();
    expect(legalHoldTargetLabel('content_removal')).toBe('Removal record');
    expect(legalHoldTargetLabel('review_case')).toBe('Review case');
  });

  test('a photo already gone is said, never claimed held', () => {
    expect(legalHoldPhotoNote({ photo: 'already_deleted' })).toMatch(/already deleted/);
    expect(legalHoldPhotoNote({ photo: 'deleting' })).toMatch(/already under way/);
    expect(legalHoldPhotoNote({ photo: 'held' })).toBeNull();
    expect(legalHoldPhotoNote({ photo: 'none' })).toBeNull();
    expect(legalHoldPhotoNote({ photo: 'none', files: { kept: 2, deleting: 0, already_deleted: 0 } })).toBeNull();
    expect(legalHoldPhotoNote({ files: { kept: 1, deleting: 1, already_deleted: 0 } })).toMatch(/1 original file\(s\) were already being deleted/);
    expect(legalHoldPhotoNote({ files: { kept: 0, deleting: 0, already_deleted: 2 } })).toMatch(/2 original file\(s\) were already deleted/);
  });

  test('the screen uses only the three existing admin functions; no table access, no new screen', () => {
    for (const fn of ['admin_place_legal_hold', 'admin_release_legal_hold', 'admin_list_legal_holds']) {
      expect(SCREEN).toContain(`'${fn}'`);
      expect(MIGRATION).toMatch(new RegExp(`function public\\.${fn}[\\s\\S]*?check_is_admin`));
    }
    expect(SCREEN).not.toMatch(/legal_holds['"]\)/);
    expect(SCREEN).not.toMatch(/from\('legal_holds'/);
    // the hold control sits on every report and review case card, and release asks for confirmation
    expect(SCREEN).toContain("renderHoldControl('report', item.id)");
    expect(SCREEN).toContain("renderHoldControl('review_case', c.id)");
    expect(SCREEN).toMatch(/Release this legal hold\?/);
    // an older database (no function) shows no hold control
    expect(SCREEN).toMatch(/setHolds\(held\.error \? null/);
  });
});

describe('hold scope (20270402)', () => {
  test('a whole-history hold says so; an ordinary one does not', () => {
    expect(legalHoldStatusLine({ reason: 'Counsel asked', scope: 'account_history' })).toMatch(/Whole account history/);
    expect(legalHoldStatusLine({ reason: 'Counsel asked', scope: 'item' })).not.toMatch(/history/);
  });
});
