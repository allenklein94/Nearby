// Who sees Report and Remove on a gathering memory (20270391); the server decides again on every action.
const { memoryActions } = require('./memoryActions');
const { reportMediaPaths, reportMediaByReport, reportMediaStatus } = require('./reportMedia');
const { reportReasonsFor, MEDIA_REPORT_CODES } = require('./reportReasons');
const { reportRow, shouldRetryWithoutContent, withoutContent, insertReport } = require('./reportContent');

describe('memoryActions', () => {
  test('your own memory: Remove, no Report, host or not', () => {
    expect(memoryActions({ user_id: 'me' }, 'me')).toEqual({ remove: 'own', report: false });
    expect(memoryActions({ user_id: 'me' }, 'me', true)).toEqual({ remove: 'own', report: false });
  });
  test("someone else's: Report; Remove only for the host", () => {
    expect(memoryActions({ user_id: 'o' }, 'me')).toEqual({ remove: null, report: true });
    expect(memoryActions({ user_id: 'o' }, 'me', true)).toEqual({ remove: 'host', report: true });
  });
  test('nothing before the viewer is known', () => {
    expect(memoryActions({ user_id: 'o' }, null, true)).toEqual({ remove: null, report: false });
    expect(memoryActions(null, 'me')).toEqual({ remove: null, report: false });
  });
});

describe('a report about a photo', () => {
  test('offers the reasons about a photo, nothing about a profile', () => {
    expect(reportReasonsFor('media').map((r) => r.code)).toEqual(MEDIA_REPORT_CODES);
    expect(MEDIA_REPORT_CODES).not.toContain('fake_profile');
  });
  const row = reportRow({ reporterId: 'r', reportedId: 'p', reason: 'Other', details: '', content: { type: 'story', id: 's1' } });
  test('carries the photo, and is refiled about the poster on an older database', () => {
    expect(row).toMatchObject({ content_type: 'story', content_id: 's1', reported_id: 'p' });
    expect(shouldRetryWithoutContent({ code: '23514', message: 'violates check constraint reports_content_type_check' }, row)).toBe(true);
    expect(withoutContent(row)).toEqual({ reporter_id: 'r', reported_id: 'p', reason: 'Other', details: '[photo s1]' });
  });
  test('a photo that has just gone is still filed about the poster, never lost', async () => {
    const sent = [];
    const run = async (r) => { sent.push(r); return sent.length === 1 ? { error: { hint: 'report_content_mismatch' } } : { error: null }; };
    expect((await insertReport(run, row)).error).toBeNull();
    expect(sent[1].content_type).toBeUndefined();
    expect(sent[1].reported_id).toBe('p');
  });
});

describe('the admin view of a reported photo', () => {
  const rows = [
    { report_id: 'a', media_path: 'p/1.jpg', file_held: true, still_live: true },
    { report_id: 'b', media_path: 'p/1.jpg', file_held: true, still_live: false },
    { report_id: 'c', media_path: 'p/2.jpg', file_held: false, still_live: false },
  ];
  test('asks for a link only for held files, once each', () => {
    expect(reportMediaPaths(rows)).toEqual(['p/1.jpg']);
    expect(reportMediaPaths(null)).toEqual([]);
  });
  test('a refused link leaves no image; a released file has none', () => {
    const m = reportMediaByReport(rows, [{ path: 'p/1.jpg', signedUrl: 'u', error: null }, { path: 'p/2.jpg', signedUrl: 'x', error: null }]);
    expect(m.a.url).toBe('u');
    expect(m.c.url).toBeNull();
    expect(reportMediaByReport(rows, [{ path: 'p/1.jpg', signedUrl: null, error: 'no' }]).a.url).toBeNull();
  });
  test('says in words where the photo stands', () => {
    expect(reportMediaStatus(rows[0])).toMatch(/Still visible/);
    expect(reportMediaStatus(rows[1])).toMatch(/Held here/);
    expect(reportMediaStatus(rows[2])).toMatch(/no longer held/);
  });
});
