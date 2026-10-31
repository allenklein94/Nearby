// Trust & safety I3 (20270355): a report may point at what was reported (a message, or a whole 1:1 chat); the server
// then keeps its own copy of it, read as the reporter. ONE rule for building the row and for staying safe on a database
// without that migration (the TestFlight build ships before it): the report is never lost because of the reference.
//   - reportRow: the insert row; content only when both type and id are known, from the allowed types.
//   - shouldRetryWithoutContent: the server doesn't know the columns yet (PGRST204 / 42703 naming content_*) OR refused
//     the reference itself (the message was deleted / isn't from this person: 'report_content_mismatch'). Then the same
//     report is filed about the person alone. Any other error is a real failure (shown with Try Again).
//   - a business offer ('business_offer', 20270372): the server sets who the report is about (the business's manager), so
//     the client sends no person. Without the columns (an older database) the report is still filed, naming the offer in
//     its details; a refusal of the offer itself (not visible to the reporter) is a real failure, never a report about nobody.
export const REPORT_CONTENT_TYPES = ['message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat', 'business_offer'];

export function reportRow({ reporterId, reportedId, reason, details, content }) {
  const row = { reporter_id: reporterId, reported_id: reportedId, reason, details: details || null };
  if (content && REPORT_CONTENT_TYPES.includes(content.type) && content.id) {
    row.content_type = content.type;
    row.content_id = content.id;
  }
  return row;
}

export function shouldRetryWithoutContent(error, row) {
  if (!error || !row?.content_type) return false;
  if (error.hint === 'report_content_mismatch') return row.content_type !== 'business_offer';
  // 20270355 without 20270372: the columns exist but 'business_offer' isn't an allowed type yet
  if (row.content_type === 'business_offer' && error.code === '23514' && /content_type/.test(String(error.message || ''))) return true;
  return (error.code === 'PGRST204' || error.code === '42703') && /content_(type|id)/.test(String(error.message || ''));
}

export function withoutContent(row) {
  const { content_type, content_id, ...rest } = row;
  if (content_type === 'business_offer') {
    return { ...rest, details: [`[offer ${content_id}]`, rest.details].filter(Boolean).join(' ') };
  }
  return rest;
}

// run(row) performs the insert and returns its { error }.
export async function insertReport(run, row) {
  const first = await run(row);
  if (!shouldRetryWithoutContent(first?.error, row)) return first;
  return run(withoutContent(row));
}
