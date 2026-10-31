// Verified Business (owner, 2026-10-31; migration 20270371). The ONE client read of the badge: which of these businesses
// show "Verified Business". The server decides (an admin recorded four passed checks, and the verified name, address and
// manager still hold); the app never decides it and never stores it.
// Decision A (LOCKED): read only by the business preview sheet and the business profile. Never by offer cards, replies,
// Opportunities, routing, matching or ranking (guard src/utils/businessVerification.test.js).
// Before 20270371 is live the function doesn't exist: that, or any other error, = no badge (unknown = nothing).
import { supabase } from './supabase';

export function verifiedIdsFrom(result) {
  if (!result || result.error || !Array.isArray(result.data)) return new Set();
  return new Set(result.data);
}

export async function getVerifiedBusinessIds(partnerIds) {
  const ids = [...new Set((partnerIds || []).filter(Boolean))].slice(0, 200);
  if (!ids.length) return new Set();
  try {
    return verifiedIdsFrom(await supabase.rpc('get_verified_business_ids', { partner_ids: ids }));
  } catch {
    return new Set();
  }
}

export async function isVerifiedBusiness(partnerId) {
  if (!partnerId) return false;
  return (await getVerifiedBusinessIds([partnerId])).has(partnerId);
}
