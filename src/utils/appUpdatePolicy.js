// The ONE rule for "does this build need an update?" (migration 20270434, owner 2026-11-27). Pure: no network, no storage.
//
//   current  = opens normally (also: build unknown, no policy, policy unreadable: never lock anyone out on a guess)
//   optional = an update exists (build below latest_build): one dismissible notice, once per newer build
//   required = build below an ENFORCED minimum (the server only returns min_supported_build while enforced), or the
//              server itself refused a request with hint 'app_update_required'
//
// The server's policy is the authority; the app only decides how to SHOW it. Enforcement itself happens on the server
// (the PostgREST pre-request check), so an older build without this code is refused there too.

export const UPDATE_REQUIRED_HINT = 'app_update_required';
export const BUILD_HEADER = 'x-nearby-build';
export const PLATFORM_HEADER = 'x-nearby-platform';
export const PLATFORMS = ['ios', 'android', 'web'];

const asBuild = (v) => {
  const n = typeof v === 'string' && /^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : v;
  return Number.isInteger(n) && n > 0 && n <= 999999 ? n : null;
};

export function normalizeBuild(v) {
  return asBuild(v);
}

// policy = the server's answer ({ min_supported_build, latest_build, update_url }) or null.
export function appUpdateState({ build, policy, serverRefused = false } = {}) {
  const b = asBuild(build);
  if (b === null) return 'current';
  if (serverRefused) return 'required';
  if (!policy || typeof policy !== 'object') return 'current';
  const min = asBuild(policy.min_supported_build);
  const latest = asBuild(policy.latest_build);
  if (min !== null && b < min) return 'required';
  if (latest !== null && b < latest) return 'optional';
  return 'current';
}

// The optional notice shows once per newer build: dismissing it hides it until latest_build goes up again.
export function showOptionalNotice({ state, policy, dismissedLatest }) {
  if (state !== 'optional') return false;
  const latest = asBuild(policy?.latest_build);
  return latest !== null && latest !== asBuild(dismissedLatest);
}

// Only links the app can open safely; anything else = no Update button (the text tells people where to update).
export function safeUpdateUrl(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  return /^(https:\/\/|itms-beta:\/\/|itms-apps:\/\/|market:\/\/)\S{3,500}$/.test(u) ? u : null;
}

export function isUpdateRequiredBody(body) {
  return !!body && typeof body === 'object' && body.hint === UPDATE_REQUIRED_HINT;
}

// Headers this build sends with every request to its own backend (both only refuse server-side, never grant).
export function versionHeaders({ build, platform }) {
  const b = asBuild(build);
  if (b === null || !PLATFORMS.includes(platform)) return null;
  return { [BUILD_HEADER]: String(b), [PLATFORM_HEADER]: platform };
}

// A cached policy is only ever used when a fresh read fails; it is tied to the backend it came from.
export function cacheKey(environment, platform) {
  return `nearby-app-version-policy:${environment || 'unknown'}:${platform}`;
}

// The policy read's answer (POST /rest/v1/rpc/get_app_version_policy, signed out): 200 = the row (null = no row for this
// platform); the function missing = this database predates 20270434 = no policy; anything else = unavailable (throws, so
// the app keeps its last known state instead of guessing either way).
export function policyFromResponse(status, body) {
  if (status === 200) return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (status === 404 && (!body || body.code === 'PGRST202' || body.code === '42883')) return null;
  throw new Error(`version policy unavailable (${status})`);
}
