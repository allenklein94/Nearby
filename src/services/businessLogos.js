// The one read of business logos for offer surfaces: get_screened_business_logos returns a logo only when its image was
// classified by screen-business-content and approved (utils/businessLogo.js). A failed read = no logos, never an
// unscreened one. Cached briefly so a card, the pill and a reload do not ask twice.
import { supabase } from './supabase';
import { logoMapFromRows } from '../utils/businessLogo';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // partnerId -> { logo: string|null, at }

export async function getScreenedLogos(partnerIds, { now = Date.now() } = {}) {
  const ids = [...new Set((partnerIds ?? []).filter((id) => typeof id === 'string' && id))].slice(0, 50);
  const result = {};
  const missing = [];
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) { if (hit.logo) result[id] = hit.logo; } else missing.push(id);
  }
  if (missing.length === 0) return result;
  try {
    const { data, error } = await supabase.rpc('get_screened_business_logos', { partner_ids: missing });
    if (error) return result;
    const fetched = logoMapFromRows(data);
    for (const id of missing) {
      cache.set(id, { logo: fetched[id] ?? null, at: now });
      if (fetched[id]) result[id] = fetched[id];
    }
  } catch {
    // network failure: no logo, and nothing cached, so the next look asks again
  }
  return result;
}

export function clearScreenedLogoCache() {
  cache.clear();
}
