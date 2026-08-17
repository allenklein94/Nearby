import { supabase } from './supabase';

// "The Offer System" Phase 4 (see CLAUDE.md's own plan, Decision 3): a
// real, general "Social Offer" primitive -- any connected person (not
// just a business) proposing how they'll fulfill part of a Request.
// Client-side wrappers around the SECURITY DEFINER RPCs in
// 20260817_offer_system_phase4_social_offers.sql -- every write goes
// through one of these, matching this schema's own "no direct client
// INSERT/UPDATE on a lifecycle table" convention. Eligibility is always
// re-validated server-side, never trusted from the client here.

export async function submitSocialOffer(requestId, offerDescription) {
  const { data, error } = await supabase.rpc('submit_social_offer', {
    request_id_param: requestId,
    offer_description_param: offerDescription,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function respondToSocialOffer(offerId, accept) {
  const { data, error } = await supabase.rpc('respond_to_social_offer', {
    offer_id_param: offerId,
    accept_param: accept,
  });
  if (error) throw new Error(error.message);
  return data;
}

// A real, honest read receipt -- fired the moment the request's own
// requester actually opens this specific offer. Idempotent and a no-op
// for anyone else, so safe to call unconditionally, fire-and-forget,
// matching Phase 3's markBusinessOfferViewed().
export async function markSocialOfferViewed(offerId) {
  const { error } = await supabase.rpc('mark_social_offer_viewed', { offer_id_param: offerId });
  if (error) console.error('markSocialOfferViewed failed', error);
}
