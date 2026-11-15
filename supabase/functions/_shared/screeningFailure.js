// Which screening failures the server retries by itself (owner, 2026-11-15; migration 20270420). Pure, shared by the
// edge function and Jest. A failure is never a verdict on the content: both kinds leave the offer unsent.
//   'transient' = it may work in a minute: no answer (network, timeout), rate limited, the provider overloaded or
//                 failing (408/409/425/429/5xx/529), or an answer we could not read. Retried about 30 s, 2 min, 5 min later.
//   'permanent' = the provider refused the call itself: billing/credit, key, permission, a bad request (400/401/402/403/
//                 404/413/422). Retrying cannot help, so it waits for Try again.
// Anything unknown counts as transient: the retries are bounded (three), and Try again still works after them.
const PERMANENT_STATUSES = new Set([400, 401, 402, 403, 404, 413, 422]);

export function screeningFailureKind({ status } = {}) {
  return Number.isInteger(status) && PERMANENT_STATUSES.has(status) ? 'permanent' : 'transient';
}
