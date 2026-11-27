// Minimum supported app version for edge functions (20270434). Edge functions don't pass through PostgREST's pre-request
// hook, so each function the app calls asks the SAME hook first: it calls public.app_version_ok() with the client's own
// version headers (x-nearby-build / x-nearby-platform) and user agent forwarded. The database alone decides (one source of
// truth: enforced minimums, strict mode for unidentified clients); this file only forwards and relays the answer.
//
//   refused  -> 426 { code: 'P0001', hint: 'app_update_required' } (the app shows its update screen)
//   allowed  -> null, the function runs
//   server-side callers (the project's secret key, or a service_role token: cron, the screening retry worker, other
//   functions) -> null without a check
//   the probe can't run (network, PostgREST down, 0434 not installed = 404) -> null: the function's own database calls
//   decide; a version-check fault never takes a function down
//
// Answers are cached per (build, platform, user agent) for 30 s, so lowering the minimum or switching enforcement off
// reaches edge functions within 30 s. Compatibility, not security: a client can claim any build; a claim can only cause a
// refusal, never grant anything.
import { publishableKey, secretKey } from './supabaseKeys.ts';

export const UPDATE_REQUIRED_HINT = 'app_update_required';
const CACHE_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
const FORWARDED = ['x-nearby-build', 'x-nearby-platform', 'user-agent'];
const cache = new Map<string, { at: number; refused: boolean }>();

// The client's version headers, to forward on every PostgREST call made AS the caller (so strict mode identifies them).
export function clientVersionHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of FORWARDED) {
    const v = req.headers.get(h);
    if (v !== null) out[h] = v.slice(0, 300);
  }
  return out;
}

function bearer(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

// True for the project's own server-side calls (never for a signed-in person's token).
export function isServerCaller(req: Request): boolean {
  const key = secretKey();
  const token = bearer(req);
  if (key && (token === key || req.headers.get('apikey') === key)) return true;
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

export function updateRequiredResponse(headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({
    error: 'A newer version of Nearby is required. Please update the app.',
    code: 'P0001',
    hint: UPDATE_REQUIRED_HINT,
  }), { status: 426, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// probe = injectable for tests; default = the real PostgREST call.
export async function appVersionRefusal(
  req: Request,
  responseHeaders: Record<string, string> = {},
  probe: (headers: Record<string, string>) => Promise<boolean> = defaultProbe,
): Promise<Response | null> {
  if (req.method === 'OPTIONS') return null;
  if (isServerCaller(req)) return null;
  const forwarded = clientVersionHeaders(req);
  const key = JSON.stringify(forwarded);
  const now = Date.now();
  const hit = cache.get(key);
  let refused: boolean;
  if (hit && now - hit.at < CACHE_MS) {
    refused = hit.refused;
  } else {
    try {
      refused = await probe(forwarded);
    } catch {
      return null; // probe failed: fail open, nothing cached
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: now, refused });
  }
  return refused ? updateRequiredResponse(responseHeaders) : null;
}

async function defaultProbe(forwarded: Record<string, string>): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = publishableKey();
  if (!url || !anon) throw new Error('not configured');
  const res = await fetch(`${url}/rest/v1/rpc/app_version_ok`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json', ...forwarded },
    body: '{}',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (res.ok) { await res.body?.cancel(); return false; }
  let body: { hint?: string } | null = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (body?.hint === UPDATE_REQUIRED_HINT) return true;
  throw new Error(`probe answered ${res.status}`); // 404 (no 0434 yet) or any other answer = unknown
}

export function _clearAppVersionCache() { cache.clear(); }
