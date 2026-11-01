import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://enmosvippabmuqslzrox.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
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