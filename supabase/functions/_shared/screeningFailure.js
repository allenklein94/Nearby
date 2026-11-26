// Which screening failures the server retries by itself (owner, 2026-11-15; migration 20270420). Pure, shared by the
// edge function and Jest. A failure is never a verdict on the content: both kinds leave the offer unsent.
//   'transient' = it may work in a minute: no answer (network, timeout), rate limited, the provider overloaded or
//                 failing (408/409/425/429/5xx/529), or an answer we could not read. Retried about 30 s, 2 min, 5 min later.
//   'permanent' = the provider refused the call itself: billing/credit, key, permission, a bad request (400/401/402/403/
//                 404/413/422). Retrying cannot help, so it waits for Try again.
// Anything unknown counts as transient: the retries are bounded (three), and Try again still works after them.
const PERMANENT_STATUSES = new Set([400, 401, 402, 403, 404, 413, 422]);

// Causes that never fix themselves on their own (screeningHealth.js, 20270387, when it is present): no credit, a missing /
// revoked key, a retired model. Passed as `healthKind` so the outage monitor and the retry read ONE classification.
const PERMANENT_HEALTH_KINDS = new Set(['credit', 'credentials', 'model']);

export function screeningFailureKind({ status, healthKind } = {}) {
  if (PERMANENT_HEALTH_KINDS.has(healthKind)) return 'permanent';
  return Number.isInteger(status) && PERMANENT_STATUSES.has(status) ? 'permanent' : 'transient';
}
