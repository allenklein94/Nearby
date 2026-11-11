import { supabase } from './supabase';
import { EMPTY_FAMILIAR_HOSTS, familiarHostsFromRows } from '../utils/hostFamiliarity';

// Host familiarity (owner, 2026-11-11; migration 20270410): who the signed-in person has really been at ended gatherings with,
// capped at 3 per person (get_my_familiar_hosts, auth.uid() inside). Read through utils/hostFamiliarity.js by the ranking
// surfaces as a tie-breaker only. A failure, or a database without 0410 (the function is missing), = an empty map: every
// order stays exactly as before. Cached 60 s like the experience feedback.
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
let cache = null;
export async function getMyFamiliarHosts() {
  if (cache && Date.now() - cache.at < 60000) return cache.value;
  const { data, error } = await supabase.rpc('get_my_familiar_hosts');
  if (error) {
    if (!MISSING_FUNCTION.has(error.code)) console.error('getMyFamiliarHosts error', error);
    cache = { at: Date.now(), value: EMPTY_FAMILIAR_HOSTS };
    return EMPTY_FAMILIAR_HOSTS;
  }
  const value = familiarHostsFromRows(data);
  cache = { at: Date.now(), value };
  return value;
}
export function resetFamiliarHostsCache() { cache = null; }
