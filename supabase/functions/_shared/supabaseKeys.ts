// The project's API keys, read from the supported variables Supabase injects into every function:
// SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS (JSON objects {name: key}; this project's key is named "default").
// No fallback to the legacy-named SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (removed 2026-10-28, owner): a missing or
// invalid variable returns undefined, so the function fails loudly instead of silently reading another name.
// Never reads or needs the legacy JWT secret.
function keyFrom(jsonVar: string): string | undefined {
  try {
    const parsed = JSON.parse(Deno.env.get(jsonVar) ?? '');
    const key = parsed?.default ?? Object.values(parsed ?? {})[0];
    if (typeof key === 'string' && key) return key;
  } catch {
    // not set or not JSON
  }
  return undefined;
}

// Service-level secret key (bypasses RLS): server-side use only, never returned to a caller.
export function secretKey(): string | undefined {
  return keyFrom('SUPABASE_SECRET_KEYS');
}

// Publishable key (public, RLS applies): for clients acting as the signed-in caller.
export function publishableKey(): string | undefined {
  return keyFrom('SUPABASE_PUBLISHABLE_KEYS');
}
