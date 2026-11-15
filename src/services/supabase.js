import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import { checkRuntimeEnvironment, serviceSwitches } from '../config/environments';

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
  })
  : refusingClient(check.error);

export function functionUrl(name) {
  if (!SUPABASE_URL) throw new Error(`Nearby is not connected: ${ENVIRONMENT_ERROR}`);
  return `${SUPABASE_URL}/functions/v1/${name}`;
}
