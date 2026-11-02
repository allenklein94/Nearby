// Crossed Paths consent (owner, 2026-11-02; server: migration 20270384). The one client source for it.
//   * OFF by default. setCrossedPathsSharing is called ONLY by the Settings switch (guarded by crossedPathsSharing.test.js):
//     never at sign-up, onboarding, from Dating/Friends or any other screen.
//   * A crossing is recorded only between two people who BOTH turned it on and share a Dating or Friends pool; the server
//     decides that, never this file. Turning it off deletes that person's crossings at once (server side).
//   * Before 20270384 is live the functions don't exist: getMyCrossedPathsSharing() answers null and Settings shows no
//     switch (an old database records crossings by pool alone; nothing here can change that).
import { supabase } from './supabase';

const MISSING = new Set(['PGRST202', '42883']);
export const isMissingFunction = (error) => !!error && (MISSING.has(error.code) || /could not find the function/i.test(error.message ?? ''));

// true / false, or null when the server doesn't have the switch yet (show nothing)
export async function getMyCrossedPathsSharing(client = supabase) {
  const { data, error } = await client.rpc('get_my_crossed_paths_sharing');
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return data === true;
}

export async function setCrossedPathsSharing(on, client = supabase) {
  const { data, error } = await client.rpc('set_crossed_paths_sharing', { enabled: !!on });
  if (error) throw error;
  return data === true;
}
