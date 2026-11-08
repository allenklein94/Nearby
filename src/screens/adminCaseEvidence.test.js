// Admin Review = the whole case; Admin Reports stays the report queue (owner, 2026-11-08). Client only: the reads below are the
// same admin-only access Admin Reports already uses (journeys trustSafety, mediaReports).
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const review = read('screens/AdminReviewScreen.js');
const reports = read('screens/AdminReportsScreen.js');
const linked = read('components/LinkedReportsSection.js');

describe('Admin Review shows the evidence that used to need Admin Reports', () => {
  test('counted activity lines, from the one helper', () => {
    expect(review).toContain('behaviorEvidenceLines(selected.evidence)');
  });
  test('linked reports: what was said + the server copy + a held photo', () => {
    expect(review).toContain('<LinkedReportsSection reports={selected.reports}');
    expect(linked).toContain('row?.details');
    expect(linked).toContain('row?.content_excerpt');
    expect(linked).toContain("'admin_get_report_media'");
  });
  test('account facts stay', () => {
    expect(review).toContain('<AccountFactsSection caseId={selected.id}');
  });
});

describe('it only reads, and through the existing access', () => {
  test('no write, navigation or action', () => {
    expect(linked).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(linked).not.toMatch(/navigate|Alert|onPress|TouchableOpacity/);
    expect(linked.match(/\.rpc\('(\w+)'/g)).toEqual([".rpc('admin_get_report_media'"]);
  });
  test('the reporter is never read', () => {
    expect(linked.match(/const COLUMNS = '([^']*)'/)[1]).not.toMatch(/reporter/);
    expect(linked).not.toMatch(/\.reporter|reporter_id/);
  });
  test('photos use the same 15-minute admin link', () => {
    expect(linked).toContain('createSignedUrls(paths, ADMIN_PHOTO_LINK_SECONDS)');
  });
  test('no score, verdict or new enforcement wording', () => {
    expect(linked).not.toMatch(/score|risk|verdict|suspicious|recommend/i);
  });
});

describe('Admin Reports stays the queue', () => {
  test('report actions and the pause / hold controls are still there', () => {
    for (const s of ['admin_resolve_report', 'renderRestrictionControl', 'renderHoldControl', 'admin_remove_reported_content']) {
      expect(reports).toContain(s);
    }
  });
  test('its own evidence lines are unchanged, and it shares the one label table', () => {
    expect(reports).toContain('behaviorEvidenceLines(c.evidence)');
    expect(reports).toContain('reportedWhatLabel(item.content_type)');
    expect(reports).not.toContain('const REPORTED_WHAT');
  });
  test('no new screen: Admin Review stays website-only and the registry has no new admin route', () => {
    expect(read('navigation/RootNavigator.js')).not.toContain('AdminReviewScreen');
  });
});
