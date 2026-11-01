import { reportRow, shouldRetryWithoutContent, withoutContent, insertReport, canReportBusiness } from './reportContent';

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

  test('a business (20270381): nobody named, never refiled about nobody, kept on an older database; never your own', () => {
    const row = reportRow({ reporterId: 'r', reportedId: null, reason: 'Impersonation', details: '', content: { type: 'business', id: 'b1' } });
    expect(row).toEqual({ reporter_id: 'r', reported_id: null, reason: 'Impersonation', details: null, content_type: 'business', content_id: 'b1' });
    expect(shouldRetryWithoutContent({ code: '22023', hint: 'report_content_mismatch' }, row)).toBe(false);
    expect(shouldRetryWithoutContent({ code: '23514', message: 'new row for relation "reports" violates check constraint "reports_content_type_check"' }, row)).toBe(true);
    expect(shouldRetryWithoutContent({ code: 'PGRST204', message: "Could not find the 'content_type' column of 'reports'" }, row)).toBe(true);
    expect(withoutContent({ ...row, reported_id: 'someone' })).toEqual({ reporter_id: 'r', reported_id: null, reason: 'Impersonation', details: '[business b1]' });
    expect(canReportBusiness('b1', null)).toBe(true);
    expect(canReportBusiness('b1', 'b2')).toBe(true);
    expect(canReportBusiness('b1', 'b1')).toBe(false);
    expect(canReportBusiness(null, null)).toBe(false);
  });

  test('Impersonation on a database with codes but without that reason: refiled as Fake profile, marked, never lost', async () => {
    const calls = [];
    const run = async (r) => { calls.push(r); return calls.length === 1 ? { error: { code: '22023', hint: 'report_reason_invalid' } } : { error: null }; };
    const res = await insertReport(run, reportRow({ reporterId: 'r', reportedId: 'p', reason: 'Impersonation', details: 'claims to be a celebrity' }));
    expect(res.error).toBeNull();
    expect(calls.map((c) => c.reason)).toEqual(['Impersonation', 'Fake profile']);
    expect(calls[1].details).toBe('[Impersonation] claims to be a celebrity');
    // any other reason refused stays refused (a real failure, Try Again)
    const other = [];
    await insertReport(async (r) => { other.push(r); return { error: { hint: 'report_reason_invalid' } }; }, reportRow({ reporterId: 'r', reportedId: 'p', reason: 'Spam or scam' }));
    expect(other).toHaveLength(1);
  });

  test('a business report on a database without codes or content columns: both fallbacks in order', async () => {
    const calls = [];
    const run = async (r) => {
      calls.push(r);
      if (calls.length === 1) return { error: { hint: 'report_reason_invalid' } };
      if (calls.length === 2) return { error: { code: '23514', message: 'violates check constraint "reports_content_type_check"' } };
      return { error: null };
    };
    const res = await insertReport(run, reportRow({ reporterId: 'r', reportedId: null, reason: 'Impersonation', content: { type: 'business', id: 'b1' } }));
    expect(res.error).toBeNull();
    expect(calls[2]).toEqual({ reporter_id: 'r', reported_id: null, reason: 'Fake profile', details: '[business b1] [Impersonation]' });
  });
});
