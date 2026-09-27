// Offer language is a RESPONSE to the person's own request, never an ad (owner item 43): "Coastal Coffee made you an
// offer", not "Sponsored" / "Promoted". Stated only when true: a reply that was a decline or a withdrawal is not an offer.
//
// Owner item 121 (2026-09-27): a business reply is one of three kinds, worded from what it really carries (no schema change;
// every reply is still a business_request_offers row):
//   availability  plain "we can take you" (Standard availability: offer_type standard, nothing concrete) -> "X can take you"
//   alternative   Offer Alternative (offer_type alt_time)                                            -> "X suggested another time"
//   offer         a title, price, discount, included items, or a discount/perk/upgrade type          -> "X made you an offer"
// Plain availability is never called an offer. This file is the one place consumer surfaces word a reply.
const REAL_OFFER = ['offered', 'accepted', 'completed'];
const OFFER_TYPES = ['discount', 'perk', 'upgrade'];

export function businessReplyKind(offer) {
  if (!offer) return 'availability';
  if (offer.offer_type === 'alt_time') return 'alternative';
  const hasItems = Array.isArray(offer.included_items) ? offer.included_items.length > 0 : Boolean(offer.included_items);
  if (OFFER_TYPES.includes(offer.offer_type) || (offer.offer_title && String(offer.offer_title).trim()) ||
      offer.offer_price != null || offer.discount_pct != null || hasItems) return 'offer';
  return 'availability';
}

const PHRASE = { availability: 'can take you', alternative: 'suggested another time', offer: 'made you an offer' };

// Activity's reply row. A decline / withdrawal / expiry is only "responded to your request".
export function businessReplyTitle(partnerName, offer) {
  const name = partnerName || 'A local business';
  return REAL_OFFER.includes(offer?.status) ? `${name} ${PHRASE[businessReplyKind(offer)]}` : `${name} responded to your request`;
}

// The status line on the offer card in BusinessRequestDetail while the reply is open ("Can take you").
export function businessReplyStatus(offer) {
  const p = PHRASE[businessReplyKind(offer)];
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// Activity's "you accepted" row.
export function acceptedReplyTitle(partnerName, offer) {
  const name = partnerName || 'A local business';
  switch (businessReplyKind(offer)) {
    case 'offer': return `You accepted ${name}'s offer`;
    case 'alternative': return `You took ${name}'s suggested time`;
    default: return `You chose ${name}`;
  }
}

// Only rich offers (a title or media) get the reveal, so this is always a real offer.
export function offerRevealHeader(partnerName) {
  return `${partnerName || 'A business'} made you an offer`;
}
