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
//   - a business itself ('business', 20270381, "Report business"): the server names NOBODY (reported_id NULL): the report is
//     about the business, never automatically its owner or staff. Without that type (an older database) it is filed the
//     same way as an offer (no person, the business named in its details).
//   - a photo ('story', 20270391: a Story or a gathering memory, one row in `stories`): the server sets who posted it and holds
//     the file as evidence, so what the client sends as the person is ignored. Without that type (an older database, or a
//     photo that has just gone) the report is still filed about the person who posted it, with the photo's id in its details.
//   - 'Impersonation' (20270381): a database with reason codes but without that reason refuses it ('report_reason_invalid');
//     the same report is then filed as 'Fake profile' with "[Impersonation]" at the start of its details. Never lost.
export const REPORT_CONTENT_TYPES = ['message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat', 'business_offer', 'business', 'story'];
// reports about something that names no person on the client (the server decides who, if anyone)
const NO_PERSON_TYPES = ['business_offer', 'business'];

// "Report business" (20270381) is offered on a business's preview sheet and profile to anyone except the people who
// manage that business (the server refuses those too). myPartnerId = the viewer's managed business, if any.
export function canReportBusiness(partnerId, myPartnerId) {
  return !!partnerId && partnerId !== myPartnerId;
}

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
  if (error.hint === 'report_content_mismatch') return !NO_PERSON_TYPES.includes(row.content_type);
  // 20270355 without 20270372 / 20270381: the columns exist but the type isn't allowed yet
  if ((NO_PERSON_TYPES.includes(row.content_type) || row.content_type === 'story') && error.code === '23514' && /content_type/.test(String(error.message || ''))) return true;
  return (error.code === 'PGRST204' || error.code === '42703') && /content_(type|id)/.test(String(error.message || ''));
}

export function withoutContent(row) {
  const { content_type, content_id, ...rest } = row;
  if (content_type === 'business_offer') {
    return { ...rest, details: [`[offer ${content_id}]`, rest.details].filter(Boolean).join(' ') };
  }
  if (content_type === 'business') {
    return { ...rest, reported_id: null, details: [`[business ${content_id}]`, rest.details].filter(Boolean).join(' ') };
  }
  if (content_type === 'story') {
    return { ...rest, details: [`[photo ${content_id}]`, rest.details].filter(Boolean).join(' ') };
  }
  return rest;
}

export function shouldRetryAsFakeProfile(error, row) {
  return !!error && error.hint === 'report_reason_invalid' && row?.reason === 'Impersonation';
}
export function asFakeProfile(row) {
  return { ...row, reason: 'Fake profile', details: ['[Impersonation]', row.details].filter(Boolean).join(' ') };
}

// run(row) performs the insert and returns its { error }.
export async function insertReport(run, row) {
  let current = row;
  let result = await run(current);
  if (shouldRetryAsFakeProfile(result?.error, current)) {
    current = asFakeProfile(current);
    result = await run(current);
  }
  if (!shouldRetryWithoutContent(result?.error, current)) return result;
  return run(withoutContent(current));
}
