import { supabase } from './supabase';

// Sponsored placement client (item 44). Everything here goes through the dedicated RPCs; nothing reads the sponsored
// tables directly (they have no client grants). The serving RPC accepts only a position and the browse category the
// person opened.

// One card per (person, category-context) for the session: the server counts an exposure the moment it serves, so a
// re-render or tab switch must reuse what it already received instead of asking again.
const sessionCache = new Map();

export function resetSponsoredSession() {
  sessionCache.clear();
}

export async function getSponsoredSpotlight({ latitude, longitude, categoryGroup = null }) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) return null;
  const key = `${uid}:${categoryGroup || 'any'}`;
  if (sessionCache.has(key)) return sessionCache.get(key);
  const { data, error } = await supabase.rpc('get_sponsored_spotlight', {
    lat_param: latitude,
    lng_param: longitude,
    category_group_param: categoryGroup,
  });
  if (error) return null; // a failed lookup shows no sponsored card; organic content is unaffected
  const card = Array.isArray(data) && data.length ? data[0] : null;
  sessionCache.set(key, card);
  return card;
}

export async function recordSponsoredTap(placementId) {
  await supabase.rpc('record_sponsored_tap', { placement_id_param: placementId });
}

export async function hideSponsoredPartner(partnerId) {
  const { error } = await supabase.rpc('hide_sponsored_partner', { partner_id_param: partnerId });
  return !error;
}

export async function clearHiddenSponsors() {
  const { error } = await supabase.rpc('clear_hidden_sponsors');
  return !error;
}

// "Report this ad": the existing reports table (moderation queue). There is no reported profile, so reported_id is null
// and the details name the business and placement.
export async function reportSponsoredPlacement(card) {
  const { data: sessionData } = await supabase.auth.getSession();
  const reporterId = sessionData?.session?.user?.id;
  if (!reporterId) return false;
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_id: null,
    reason: 'Sponsored content',
    details: `placement:${card.placement_id} partner:${card.partner_id}`,
  });
  return !error;
}
