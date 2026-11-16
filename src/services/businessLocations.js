import { supabase } from './supabase';
import { locationPlanForLink } from '../utils/businessLocations';

// Multi-location Business Mode (migration 20270424, STAGED). Until 0424 is live the function doesn't exist: the read
// returns [] (no selector), exactly today's single-location experience.
export async function getMyBusinessLocations() {
  const { data, error } = await supabase.rpc('get_my_businesses');
  if (error) return [];
  return data ?? [];
}

// Rollout gate (20270426): this sign-in session runs a location-aware client (it names the location it shows). The server
// adds a second location to an account only while every live session of it has said so. Fire and forget; before 0426 is
// live the function doesn't exist and nothing happens.
export async function noteLocationAwareSession() {
  try { await supabase.rpc('note_location_aware_session'); } catch { /* best effort */ }
}

// Throws on refusal / failure; the caller shows Try again and keeps the current location.
export async function selectBusinessLocation(partnerId) {
  const { error } = await supabase.rpc('select_managed_business', { partner_id_param: partnerId });
  if (error) throw error;
  return partnerId;
}

// A tapped business push or an alert email link names its location (partner_id, 20270424). Switch to it first when it is
// another of the account's locations, so it opens on the right business. Returns { switchedTo, open }:
//   open = true  -> open the destination (switchedTo = the id switched to, else null: already there / nothing to compare);
//   open = false -> the named location is not one this account can switch to now (not a member, refused, network failure):
//                   the caller opens plain Opportunities, never that request under the location currently selected.
export async function ensureBusinessLocationForPush(data) {
  if (typeof data?.partner_id !== 'string') return { switchedTo: null, open: true };
  let plan;
  // (locationPlanForLink also returns 'open' for pushes that aren't the owner's business alerts.)
  try {
    plan = locationPlanForLink(data, await getMyBusinessLocations());
  } catch {
    return { switchedTo: null, open: true };
  }
  if (plan.action === 'open') return { switchedTo: null, open: true };
  if (plan.action === 'fallback') return { switchedTo: null, open: false };
  try {
    await selectBusinessLocation(plan.partnerId);
    return { switchedTo: plan.partnerId, open: true };
  } catch {
    return { switchedTo: null, open: false };
  }
}
