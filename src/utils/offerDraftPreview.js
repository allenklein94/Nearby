// Item 49: the owner's live Customer Preview. Maps the offer form's draft to the customer-visible offer
// row, field for field what handleSubmitOffer would send, so the preview (OfferCustomerBody + presentOffer)
// shows exactly the card the customer will get. A piece Send would refuse (bad end time, half a window,
// a discount over the limit, an alternative with no time, a second time with no first) is left out, never shown as if it would go.
// null = nothing to preview yet (no description: Send requires one), so the form shows no placeholder.

import { validUntilFromChoice, availableWindowFromChoice } from './offerMedia';
import { parseDiscountPct, discountCapProblem } from './discountCap';

// Item 119: the second time a reply sends (ISO) -- only on an alternative-time reply, only beside a first time, and not
// when it is the same time as the first (that is one time). Send and the preview both use this, so they cannot differ.
export function draftSecondTime(type, first, second) {
  const ok = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  if (type !== 'alt_time' || !ok(first) || !ok(second) || second.getTime() === first.getTime()) return null;
  return second.toISOString();
}

// Item 119b: the second time's headcount when the business made it for fewer people (null = the whole party). Only beside a
// real second time, and only a whole number from 1 to one fewer than the request's party; anything else sends nothing.
export function draftSecondPartySize(type, first, second, size, total) {
  if (!draftSecondTime(type, first, second)) return null;
  const n = Number(size);
  const whole = Number(total);
  if (!Number.isInteger(n) || !Number.isInteger(whole) || whole < 2 || n < 1 || n >= whole) return null;
  return n;
}

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
    proposed_time_alt: draftSecondTime(type, draft.proposedTime, draft.proposedTimeAlt),
    proposed_party_size_alt: draftSecondPartySize(type, draft.proposedTime, draft.proposedTimeAlt, draft.partySizeAlt, draft.requestPartySize),
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
