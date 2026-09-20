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

// ---- Owner side (Promotions). All through RPCs / the checkout function; payment state is never written from here. ----
export async function checkMySponsoredSlot(startsAtIso = null) {
  const { data, error } = await supabase.rpc('check_my_sponsored_slot', { starts_param: startsAtIso });
  return error ? null : data;
}

export async function getMySponsoredPlacements() {
  const [{ data: rows, error }, { data: stats }] = await Promise.all([
    supabase.rpc('get_my_sponsored_placements'),
    supabase.rpc('get_my_sponsored_stats'),
  ]);
  if (error) return null;
  const byId = new Map((stats || []).map((s) => [s.placement_id, s]));
  return (rows || []).map((r) => ({ ...r, impressions: byId.get(r.placement_id)?.impressions ?? null, taps: byId.get(r.placement_id)?.taps ?? null }));
}

export async function cancelMySponsoredHold(placementId) {
  const { data, error } = await supabase.rpc('cancel_my_sponsored_hold', { placement_id_param: placementId });
  return !error && data === true;
}

// Returns { url } to open Stripe Checkout, or { error }. The server decides the price and screens the text.
export async function startSponsoredCheckout({ itemKind, itemId, startDate, title, description, termsVersion, acceptedTerms }) {
  const { data, error } = await supabase.functions.invoke('create-sponsored-checkout', {
    body: { itemKind, itemId, startDate, title, description, termsVersion, acceptedTerms: acceptedTerms === true },
  });
  if (error) {
    let message = "Couldn't start checkout. You have not been charged.";
    try { const b = await error.context?.json?.(); if (b?.error) message = b.error; } catch (e) { /* keep default */ }
    return { error: message };
  }
  return data?.url ? { url: data.url } : { error: data?.error || "Couldn't start checkout. You have not been charged." };
}

// ---- Finance approver (refunds). The database decides who may and how much; this only relays the choice. ----
export async function listSponsoredPaymentsForApprover() {
  const { data, error } = await supabase.rpc('admin_list_sponsored_payments');
  if (error) return { error: /not_an_approver/.test(error.message || '') ? 'not_an_approver' : 'failed' };
  return { rows: data || [] };
}

export async function requestSponsoredRefund({ paymentId, kind, undeliveredDays = null, reason }) {
  const { data, error } = await supabase.functions.invoke('admin-sponsored-refund', {
    body: { paymentId, kind, undeliveredDays, reason },
  });
  if (error) {
    let message = 'The refund could not be started. Nothing was refunded.';
    try { const b = await error.context?.json?.(); if (b?.error) message = b.error; } catch (e) { /* keep default */ }
    return { error: message };
  }
  return data?.refunded ? { amountCents: data.amountCents } : { error: data?.error || 'Nothing was refunded.' };
}

// A business cancels its own PAID spotlight before it starts (full refund). The database decides eligibility and amount.
export async function cancelPaidSponsoredPlacement(placementId) {
  const { data, error } = await supabase.functions.invoke('cancel-sponsored-placement', { body: { placementId } });
  if (error) {
    let message = 'The cancellation could not be completed. Your spotlight is unchanged.';
    try { const b = await error.context?.json?.(); if (b?.error) message = b.error; } catch (e) { /* keep default */ }
    return { error: message };
  }
  return data?.cancelled ? { amountCents: data.amountCents } : { error: data?.error || 'Your spotlight is unchanged.' };
}
