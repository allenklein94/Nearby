// Offer language is a RESPONSE to the person's own request, never an ad (owner item 43): "Coastal Coffee made you an
// offer", not "Sponsored" / "Promoted". Stated only when true: a reply that was a decline or a withdrawal is not an offer.
const REAL_OFFER = ['offered', 'accepted', 'completed'];

export function businessReplyTitle(partnerName, offer) {
  const name = partnerName || 'A local business';
  return REAL_OFFER.includes(offer?.status) ? `${name} made you an offer` : `${name} responded to your request`;
}

export function offerRevealHeader(partnerName) {
  return `${partnerName || 'A business'} made you an offer`;
}
