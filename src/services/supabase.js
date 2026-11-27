import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import { checkRuntimeEnvironment, serviceSwitches } from '../config/environments';
import { withActingBusiness } from './actingBusiness';
import { withAppVersion } from './appVersion';

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
// Throws on a network / server failure so the caller keeps its last known policy instead of guessing.
export async function readAppVersionPolicy(platform) {
  if (!check.ok) return null;
  const { data, error } = await supabase.rpc('get_app_version_policy', { platform_param: platform });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return null;
    throw new Error(error.message || 'version policy unavailable');
  }
  return data || null;
}
