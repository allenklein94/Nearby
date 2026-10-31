import { reportRow, shouldRetryWithoutContent, withoutContent, insertReport } from './reportContent';

describe('report content reference (I3, 20270355): never lost because of the reference', () => {
  const base = { reporterId: 'r', reportedId: 'p', reason: 'Spam or scam', details: '' };

  test('content only with a known type and an id', () => {
    expect(reportRow(base)).toEqual({ reporter_id: 'r', reported_id: 'p', reason: 'Spam or scam', details: null });
    expect(reportRow({ ...base, content: { type: 'message', id: 'm1' } })).toMatchObject({ content_type: 'message', content_id: 'm1' });
    expect(reportRow({ ...base, content: { type: 'match_chat', id: 'x' } }).content_type).toBe('match_chat');
    expect(reportRow({ ...base, content: { type: 'photo', id: 'x' } }).content_type).toBeUndefined();
    expect(reportRow({ ...base, content: { type: 'message' } }).content_type).toBeUndefined();
    // the client never sends an excerpt: the server copies the content itself
    expect(Object.keys(reportRow({ ...base, content: { type: 'message', id: 'm1' } }))).not.toContain('content_excerpt');
  });

  test('retry without the reference only when the DB lacks the columns or refused the reference', () => {
    const row = reportRow({ ...base, content: { type: 'message', id: 'm1' } });
    expect(shouldRetryWithoutContent({ code: 'PGRST204', message: "Could not find the 'content_id' column of 'reports'" }, row)).toBe(true);
    expect(shouldRetryWithoutContent({ code: '42703', message: 'column "content_type" of relation "reports" does not exist' }, row)).toBe(true);
    expect(shouldRetryWithoutContent({ code: '22023', hint: 'report_content_mismatch' }, row)).toBe(true);
    expect(shouldRetryWithoutContent({ message: 'Network request failed' }, row)).toBe(false);
    expect(shouldRetryWithoutContent({ hint: 'rate_limited' }, row)).toBe(false);
    expect(shouldRetryWithoutContent({ hint: 'report_content_mismatch' }, reportRow(base))).toBe(false);
    expect(withoutContent(row)).toEqual(reportRow(base));
  });

  test('insertReport files the same report about the person when the reference is refused', async () => {
    const calls = [];
    const run = async (r) => { calls.push(r); return calls.length === 1 ? { error: { hint: 'report_content_mismatch' } } : { error: null }; };
    const res = await insertReport(run, reportRow({ ...base, content: { type: 'message', id: 'gone' } }));
    expect(res.error).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1].content_id).toBeUndefined();
    expect(calls[1].reason).toBe('Spam or scam');
  });

  test('a business offer (20270372): no person from the client, never refiled about nobody, kept on an older database', () => {
    const row = reportRow({ reporterId: 'r', reportedId: null, reason: 'Spam or scam', details: '', content: { type: 'business_offer', id: 'o1' } });
    expect(row).toEqual({ reporter_id: 'r', reported_id: null, reason: 'Spam or scam', details: null, content_type: 'business_offer', content_id: 'o1' });
    expect(shouldRetryWithoutContent({ code: '22023', hint: 'report_content_mismatch' }, row)).toBe(false);
    expect(shouldRetryWithoutContent({ code: '23514', message: 'new row for relation "reports" violates check constraint "reports_content_type_check"' }, row)).toBe(true);
    expect(shouldRetryWithoutContent({ code: '42703', message: 'column "content_type" of relation "reports" does not exist' }, row)).toBe(true);
    expect(withoutContent(row)).toEqual({ reporter_id: 'r', reported_id: null, reason: 'Spam or scam', details: '[offer o1]' });
    expect(withoutContent({ ...row, details: 'pushy' }).details).toBe('[offer o1] pushy');
  });
});
