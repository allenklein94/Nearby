// Trust & safety N6 (owner, 2026-10-28): another signed-in person can read only a profile's public columns
// (PUBLIC_PROFILE_COLUMNS, the column grant in migration 20270348). The person's OWN private columns (birthdate, settings,
// counters, managed business, ...) come from ONE read: the server's get_my_profile() (the caller's own row only).
// Every own-profile read that names a private column goes through readMyProfile (guard: myProfileReads.test.js).
// Until 20270348 is live the function doesn't exist (PGRST202), so the same columns are read the old way; once it is
// live the first call always succeeds. Returns { data, error } like the query it replaces; data = the row or null.
import { supabase } from './supabase';

export { PUBLIC_PROFILE_COLUMNS } from '../constants/publicProfileColumns';

export function isMissingFunction(error) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883');
}

export async function readMyProfile(columns = '*') {
  const first = await supabase.rpc('get_my_profile').select(columns).maybeSingle();
  if (!isMissingFunction(first?.error)) return first;
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) return { data: null, error: null };
  return supabase.from('profiles').select(columns).eq('id', uid).maybeSingle();
}
