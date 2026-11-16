import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { resolveBackend } from '../config/backend';
import { withActingBusiness } from './actingBusiness';

// Production by default (no override in the build). A staging build (APP_VARIANT=staging, app.config.js) carries its own
// URL + key; if anything in it points at production, no client is created and nothing is sent (fail closed).
const BACKEND = resolveBackend(Constants.expoConfig?.extra);
if (!BACKEND.ok) throw new Error(`Nearby backend configuration refused: ${BACKEND.problems.join('; ')}`);
export const BACKEND_VARIANT = BACKEND.variant;
const SUPABASE_URL = BACKEND.url;
const SUPABASE_ANON_KEY = BACKEND.key;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Multi-location (20270426): REST calls name the location Business Mode shows; the server refuses them once another
  // device switched the account to a different location (services/actingBusiness.js).
  global: { fetch: withActingBusiness((...args) => fetch(...args)) },
});

// A throw-away client for a step-up sign-in (20270375): its session is never stored and never replaces the person's own.
export function createIsolatedAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function functionUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}