// Screening provider health (owner, 2026-11-02): tells an administrator when business-content screening is unavailable.
// Pure where it decides: `screeningFailureKind` reads only the HTTP status + the provider's own error type/message, never
// the content being screened; `reportScreeningHealth` posts only { ok, kind, status, source } to the service-role function
// public.record_screening_service_result (20270387), which opens / closes ONE outage and alerts admins without repeats.
//
// This NEVER changes a verdict or the fail-closed rule: a failed or slow report is ignored (short timeout), the caller still
// returns its own "service unavailable" result. A content verdict (low / medium / high / uncertain) is never a failure:
// only a provider or infrastructure problem is reported.

export const SCREENING_FAILURE_KINDS = Object.freeze([
  'credit',          // provider says the account has no credit / billing problem
  'credentials',     // missing, invalid or revoked API key, or permission denied
  'model',           // the requested model doesn't exist / was retired
  'rate_limit',      // 429
  'timeout',         // our own request timeout fired
  'provider_error',  // 5xx / 529 overloaded / network failure / anything else unexpected
  'bad_reply',       // the provider answered, but not with the JSON verdict we asked for
]);

// Kinds that open an outage on the FIRST failure (they don't fix themselves); the others need repeats (20270387).
export const DEFINITIVE_FAILURE_KINDS = Object.freeze(['credit', 'credentials', 'model']);

export function screeningFailureKind({ status = null, body = null, error = null, keyMissing = false } = {}) {
  if (keyMissing) return 'credentials';
  if (error) {
    const name = String(error?.name ?? '');
    return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'provider_error';
  }
  const type = String(body?.error?.type ?? '');
  const message = String(body?.error?.message ?? '');
  if (/credit balance|billing|purchase credits|insufficient.{0,20}(credit|funds|balance)/i.test(message)) return 'credit';
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') return 'credentials';
  if (status === 404 || type === 'not_found_error' || (/\bmodel\b/i.test(message) && /not.?found|does not exist|deprecat|retired/i.test(message))) return 'model';
  if (status === 429 || type === 'rate_limit_error') return 'rate_limit';
  return 'provider_error';
}

// Fire-and-wait (max 3 s) report; returns nothing and never throws. `url` = SUPABASE_URL, `key` = the secret key
// (supabaseKeys.ts secretKey(); service role, server-side only, never in the report itself).
export async function reportScreeningHealth({ ok, kind = null, status = null, source = 'business-content' }, { url, key } = {}, fetchImpl = fetch) {
  try {
    if (!url || !key) return;
    if (!ok && !SCREENING_FAILURE_KINDS.includes(kind)) kind = 'provider_error';
    await fetchImpl(`${url}/rest/v1/rpc/record_screening_service_result`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        source_param: source,
        ok_param: !!ok,
        kind_param: ok ? null : kind,
        http_status_param: Number.isInteger(status) ? status : null,
      }),
    });
  } catch (_e) {
    // Monitoring must never affect screening: ignore.
  }
}
