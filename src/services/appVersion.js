// App version check (migration 20270434): which build this is, what the server's policy says, and the resulting state for
// AppUpdateGate. Rechecked at start-up, on sign-in, when the app returns to the foreground, from "Check again", and at once
// when the server refuses a request as too old. A failed read never makes the app stricter: it keeps the last policy it
// had for this backend (offline after a required update = still required; otherwise = opens normally).
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { WEB_RELEASE_BUILD } from '../constants/appRelease';
import {
  appUpdateState, cacheKey, isUpdateRequiredBody, normalizeBuild, versionHeaders,
} from '../utils/appUpdatePolicy';

export const APP_PLATFORM = ['ios', 'android', 'web'].includes(Platform.OS) ? Platform.OS : null;
export const APP_BUILD = APP_PLATFORM === 'web' ? WEB_RELEASE_BUILD : normalizeBuild(Application.nativeBuildVersion);
export const VERSION_HEADERS = versionHeaders({ build: APP_BUILD, platform: APP_PLATFORM });

const DISMISS_KEY = 'nearby-app-update-dismissed-latest';

let snapshot = { state: 'current', policy: null, serverRefused: false, dismissedLatest: null, checking: false };
let environment = null;
let reader = null;
let inFlight = null;
const listeners = new Set();

function emit(next) {
  snapshot = { ...snapshot, ...next };
  snapshot.state = appUpdateState({ build: APP_BUILD, policy: snapshot.policy, serverRefused: snapshot.serverRefused });
  listeners.forEach((l) => { try { l(snapshot); } catch { /* a listener never breaks the check */ } });
}

export function appVersionSnapshot() { return snapshot; }
export function onAppVersionChange(l) { listeners.add(l); return () => listeners.delete(l); }

// readPolicy(platform) -> the server's row or throws. Injected by the caller (services/supabase.js) to avoid a cycle.
export async function initAppVersion({ env, readPolicy }) {
  environment = env; reader = readPolicy;
  if (!APP_PLATFORM) return snapshot;
  try {
    const [cached, dismissed] = await Promise.all([
      AsyncStorage.getItem(cacheKey(environment, APP_PLATFORM)), AsyncStorage.getItem(DISMISS_KEY),
    ]);
    emit({ policy: cached ? JSON.parse(cached) : null, dismissedLatest: normalizeBuild(dismissed) });
  } catch { /* no cache: stays current until the server answers */ }
  return recheckAppVersion();
}

export function recheckAppVersion() {
  if (!reader || !APP_PLATFORM) return Promise.resolve(snapshot);
  if (inFlight) return inFlight;
  emit({ checking: true });
  inFlight = (async () => {
    try {
      const policy = await reader(APP_PLATFORM);
      // A fresh answer replaces the cache; "no row / no function yet" = no policy (the database predates 20270434).
      const p = policy && typeof policy === 'object' ? policy : null;
      emit({ policy: p, serverRefused: false, checking: false });
      try {
        if (p) await AsyncStorage.setItem(cacheKey(environment, APP_PLATFORM), JSON.stringify(p));
        else await AsyncStorage.removeItem(cacheKey(environment, APP_PLATFORM));
      } catch { /* cache is best effort */ }
    } catch {
      emit({ checking: false }); // offline / unavailable: keep what we had
    } finally {
      inFlight = null;
    }
    return snapshot;
  })();
  return inFlight;
}

export async function dismissOptionalUpdate() {
  const latest = normalizeBuild(snapshot.policy?.latest_build);
  if (latest === null) return;
  emit({ dismissedLatest: latest });
  try { await AsyncStorage.setItem(DISMISS_KEY, String(latest)); } catch { /* best effort */ }
}

// Wraps fetch for the Supabase client: sends this build's version headers and notices the server's "update required".
export function withAppVersion(baseFetch) {
  return async (input, init) => {
    if (!VERSION_HEADERS) return baseFetch(input, init);
    const headers = new Headers(init?.headers ?? (typeof input === 'object' ? input?.headers : undefined));
    Object.entries(VERSION_HEADERS).forEach(([k, v]) => headers.set(k, v));
    const response = await baseFetch(input, { ...init, headers });
    if (response.status === 400) {
      try {
        if (isUpdateRequiredBody(await response.clone().json())) {
          emit({ serverRefused: true });
          recheckAppVersion();
        }
      } catch { /* not JSON: not ours */ }
    }
    return response;
  };
}
