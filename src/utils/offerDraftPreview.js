// Item 49: the owner's live Customer Preview. Maps the offer form's draft to the customer-visible offer
// row, field for field what handleSubmitOffer would send, so the preview (OfferCustomerBody + presentOffer)
// shows exactly the card the customer will get. A piece Send would refuse (bad end time, half a window,
// a discount over the limit, an alternative with no time) is left out, never shown as if it would go.
// null = nothing to preview yet (no description: Send requires one), so the form shows no placeholder.

import { validUntilFromChoice, availableWindowFromChoice } from './offerMedia';
import { parseDiscountPct, discountCapProblem } from './discountCap';

export function draftPreviewOffer(draft, now = new Date()) {
  const description = String(draft?.description ?? '').trim();
  if (!description) return null;
  const type = draft.type;
  const priceText = String(draft.price ?? '').trim();
  const priceNum = priceText ? parseFloat(priceText) : null;
  const validity = validUntilFromChoice(draft.validDay, draft.validTime, now);
  const win = availableWindowFromChoice(draft.availFrom, draft.availUntil);
  const discountOk = !discountCapProblem({ offerType: type, pctInput: draft.discount, cap: draft.discountCap ?? null });
  const creative = draft.creative ?? null;
  return {
    offer_type: type,
    offer_title: String(draft.title ?? '').trim() || null,
    offer_description: description,
    included_items: draft.includedItems ?? [],
    proposed_time: type === 'alt_time' && draft.proposedTime ? draft.proposedTime.toISOString() : null,
    offer_price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
    price_is_per_person: !!draft.priceIsPerPerson,
    discount_pct: type === 'discount' && discountOk ? parseDiscountPct(draft.discount) : null,
    available_from: win.error ? null : win.from ?? null,
    available_until: win.error ? null : win.until ?? null,
    valid_until: validity.error ? null : validity.iso ?? null,
    media_path: creative?.media_path ?? null,
    media_type: creative?.media_type ?? null,
    media_poster_path: creative?.poster_path ?? null,
  };
}
