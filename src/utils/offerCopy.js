// Offer language is a RESPONSE to the person's own request, never an ad (owner item 43): "Coastal Coffee made you an
// offer", not "Sponsored" / "Promoted". Stated only when true: a reply that was a decline or a withdrawal is not an offer.
//
// Owner item 121 (2026-09-27): a business reply is one of three kinds, worded from what it really carries (no schema change;
// every reply is still a business_request_offers row):
//   availability  plain "we can take you" (Standard availability: offer_type standard, nothing concrete) -> "X can take you"
//   alternative   Offer Alternative (offer_type alt_time)                                            -> "X suggested another time"
//   offer         a title, price, discount, included items, or a discount/perk/upgrade type          -> "X made you an offer"
// Plain availability is never called an offer. This file is the one place consumer surfaces word a reply.
import { tr } from '../i18n/translate';

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

// Localization pass 5: every consumer line below reads ui.offerCopy in the current language; its English is the locked copy
// ("X can take you" / "X suggested another time" / "X made you an offer").
const KIND_KEY = { availability: 'Availability', alternative: 'Alternative', offer: 'Offer' };

// Activity's reply row. A decline / withdrawal / expiry is only "responded to your request".
export function businessReplyTitle(partnerName, offer) {
  const name = partnerName || tr('ui.offerCopy.aLocalBusiness');
  return REAL_OFFER.includes(offer?.status)
    ? tr(`ui.offerCopy.reply${KIND_KEY[businessReplyKind(offer)]}`, { name })
    : tr('ui.offerCopy.replyResponded', { name });
}

// The status line on the offer card in BusinessRequestDetail while the reply is open ("Can take you").
export function businessReplyStatus(offer) {
  return tr(`ui.offerCopy.status${KIND_KEY[businessReplyKind(offer)]}`);
}

// Activity's "you accepted" row.
export function acceptedReplyTitle(partnerName, offer) {
  const name = partnerName || tr('ui.offerCopy.aLocalBusiness');
  switch (businessReplyKind(offer)) {
    case 'offer': return tr('ui.offerCopy.acceptedOffer', { name });
    case 'alternative': return tr('ui.offerCopy.acceptedAlternative', { name });
    default: return tr('ui.offerCopy.acceptedChose', { name });
  }
}

// Only rich offers (a title or media) get the reveal, so this is always a real offer.
export function offerRevealHeader(partnerName) {
  return tr('ui.offerCopy.revealHeader', { name: partnerName || tr('ui.offerCopy.aBusiness') });
}

// The in-app arrival signal (services/offerArrivals.js). One reply = the same line Activity uses ("Coastal Coffee made you
// an offer"); several = "2 offers came in" only when every one really is an offer, else "2 replies came in" (item 121:
// plain availability is never called an offer).
export function arrivalSignalTitle(signal) {
  const items = signal?.items ?? [];
  if (items.length === 0) return null;
  if (items.length === 1) return businessReplyTitle(items[0].partnerName, items[0].offer);
  const allOffers = items.every((i) => businessReplyKind(i.offer) === 'offer');
  return tr(allOffers ? 'ui.offerCopy.arrivalOffers' : 'ui.offerCopy.arrivalReplies', { count: items.length });
}

export function arrivalSignalA11y(signal) {
  const title = arrivalSignalTitle(signal);
  return title ? tr('ui.offerCopy.arrivalOpenA11y', { title }) : null;
}
