import { supabase } from './supabase';
import { learnProximity } from '../utils/learnedProximity';

// The caller's learned trip distances per category (item 137), loaded once per session and refreshed after a minute.
// Best-effort: any failure = {} (nothing learned = the default ordering). The explicit "things to do" notification
// distance, when the person set one, caps what is learned (an explicit maximum is never exceeded).
const TTL_MS = 60 * 1000;
let cache = null;

export function resetLearnedProximityCache() { cache = null; }

export async function getMyLearnedProximity() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return {};
    const [{ data: rows, error }, { data: profile }] = await Promise.all([
      supabase.rpc('get_my_trip_choices'),
      supabase.from('profiles').select('notify_things_to_do_max_distance_miles').eq('id', uid).maybeSingle(),
    ]);
    if (error) return {};
    const value = learnProximity(rows ?? [], { maxMiles: profile?.notify_things_to_do_max_distance_miles ?? null });
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return {};
  }
}
