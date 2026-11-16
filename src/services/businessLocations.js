import { supabase } from './supabase';
import { locationToSelectForPush } from '../utils/businessLocations';

// Multi-location Business Mode (migration 20270424, STAGED). Until 0424 is live the function doesn't exist: the read
// returns [] (no selector), exactly today's single-location experience.
export async function getMyBusinessLocations() {
  const { data, error } = await supabase.rpc('get_my_businesses');
  if (error) return [];
  return data ?? [];
}

// Throws on refusal / failure; the caller shows Try again and keeps the current location.
export async function selectBusinessLocation(partnerId) {
  const { error } = await supabase.rpc('select_managed_business', { partner_id_param: partnerId });
  if (error) throw error;
  return partnerId;
}

// A tapped business push names its location (partner_id, 20270424). Switch to it first when it is another of the
// account's locations, so the push opens on the right business. Best effort: any failure keeps the current location
// (the destination then says "no longer available", exactly as today). Returns the id switched to, else null.
export async function ensureBusinessLocationForPush(data) {
  if (typeof data?.partner_id !== 'string') return null;
  try {
    const target = locationToSelectForPush(data, await getMyBusinessLocations());
    if (!target) return null;
    await selectBusinessLocation(target);
    return target;
  } catch {
    return null;
  }
}
