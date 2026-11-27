import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import { checkRuntimeEnvironment, serviceSwitches } from '../config/environments';
import { withActingBusiness } from './actingBusiness';
import { withAppVersion, VERSION_HEADERS } from './appVersion';
import { policyFromResponse } from '../utils/appUpdatePolicy';

// Which backend this build talks to comes ONLY from the values app.config.js embedded (src/config/environments.js).
// A missing or mixed configuration creates no client: every use throws, App.js shows ConfigErrorScreen, no request is sent.
const check = checkRuntimeEnvironment(Constants.expoConfig?.extra?.nearbyEnv);

export const ENVIRONMENT_ERROR = check.ok ? null : check.error;
export const ENVIRONMENT = check.ok ? check.env.variant : null;
export const SERVICES = serviceSwitches(ENVIRONMENT);

const SUPABASE_URL = check.ok ? check.env.supabaseUrl : null;
// The publishable key of THIS build's backend (public by design), for the few direct fetches that send it themselves.
export const PUBLISHABLE_KEY = check.ok ? check.env.publishableKey : null;

function refusingClient(reason) {
  const fail = () => { throw new Error(`Nearby is not connected: ${reason}`); };
  return new Proxy({}, { get: fail });
}

export const supabase = check.ok
  ? createClient(SUPABASE_URL, check.env.publishableKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Multi-location (20270426): REST calls name the location Business Mode shows; the server refuses them once another
    // device switched the account to a different location (services/actingBusiness.js).
    // Every request also says which build sent it (20270434): the server refuses builds below an enforced minimum.
    global: { fetch: withAppVersion(withActingBusiness((...args) => fetch(...args))) },
  })
  : refusingClient(check.error);

// A throw-away client for a step-up sign-in (20270375): its session is never stored and never replaces the person's own.
export function createIsolatedAuthClient() {
  if (!check.ok) return refusingClient(check.error);
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function functionUrl(name) {
  if (!SUPABASE_URL) throw new Error(`Nearby is not connected: ${ENVIRONMENT_ERROR}`);
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

// The server's version policy for this platform (20270434), or null when this database has none yet (function missing).
// A plain signed-out call with only the publishable key: an expired or unrefreshable session never stops the check (and
// never logs anyone out). Throws on a network / server failure or after 10 s, so the caller keeps its last known policy
// instead of guessing.
export async function readAppVersionPolicy(platform) {
  if (!check.ok) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_app_version_policy`, {
      method: 'POST',
      headers: { apikey: check.env.publishableKey, 'Content-Type': 'application/json', ...(VERSION_HEADERS || {}) },
      body: JSON.stringify({ platform_param: platform }),
      signal: controller?.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty or not JSON */ }
    return policyFromResponse(res.status, body);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
