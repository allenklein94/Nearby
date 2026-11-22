// Make an Offer's live Customer Preview dock (owner, 2026-11-22). The preview stays reachable for the whole edit without
// taking the screen: one line pinned under the form ("CUSTOMER PREVIEW · 20% off · $40 · Sat 7:15 PM"), tapped open to the
// full customer card (the same OfferCustomerBody + presentOffer the customer's real card uses: item 49 / item 21, never a
// second preview), with Send Offer beside it. Pure rules here; the screen only renders them.
import { offerPriceLabel } from './outcomeDisplay';
import { discountHeadlinePct } from './offerPresentation';

// Share of the window the opened card may take at most; past it the card scrolls inside the dock, the form keeps the rest.
export const OFFER_PREVIEW_CARD_MAX_FRACTION = 0.4;
const SUMMARY_TEXT_MAX = 48;

// What the dock shows. While the keyboard is up only the one-line bar stays (the opened card and Send Offer step aside so
// the field being typed in and the keyboard stay clear); they come back when it goes down. Nothing to preview = no bar.
export function offerPreviewDockLayout({ hasPreview, expanded, keyboardVisible }) {
  const bar = !!hasPreview;
  return { bar, card: bar && !!expanded && !keyboardVisible, send: !keyboardVisible };
}

function firstLine(text) {
  const s = String(text ?? '').split('\n')[0].trim();
  return s.length > SUMMARY_TEXT_MAX ? `${s.slice(0, SUMMARY_TEXT_MAX - 1).trimEnd()}…` : s;
}

// The bar's one line, from the card's own pieces in the card's order (headline, price, time); never words the card lacks.
// `t` = the language's translate (for the card's own "{pct}% off"), `formatTime` = the card's time format.
export function offerPreviewSummary(offer, { t, formatTime }) {
  if (!offer) return '';
  const pct = discountHeadlinePct(offer);
  const headline = pct != null ? t('ui.requestDetail.percentOff', { pct }) : firstLine(offer.offer_title || offer.offer_description);
  const time = offer.proposed_time ? formatTime(offer.proposed_time) : null;
  return [headline, offerPriceLabel(offer.offer_price, offer.price_is_per_person), time].filter(Boolean).join(' · ');
}
