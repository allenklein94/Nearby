// Item 118 (owner, 2026-10-16): the ONE client rule for a business's single revision of an offer it already sent.
// PRICE AND TIME ONLY: the price may only go down or stay (offer_price lower or equal; a discount_pct bigger or equal),
// the reply's own time(s) may move earlier or later (same number of times), once, while the offer is still open, and only
// on a reply the business wrote (never an automatic one). The server's revise_business_offer is the authority; this
// mirrors it so the sheet never offers a send the server would refuse. The customer's card shows the current terms only
// (never the previous price or a saving); `isRevisedOffer` is the one fact behind its "Updated" word.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const ms = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

export function isRevisedOffer(offer) {
  return Number(offer?.revision ?? 0) > 0;
}

// Which terms this reply has that a revision may change: a price only where it stated one, a discount only where it
// had one, its time(s) only where it proposed one (1 or 2).
export function revisableTerms(offer) {
  const times = ms(offer?.proposed_time) == null ? 0 : (ms(offer?.proposed_time_alt) == null ? 1 : 2);
  return { price: num(offer?.offer_price) != null, discount: num(offer?.discount_pct) != null, times };
}

const isAutomatic = (offer) => !!(offer?.availability_id || offer?.package_id || offer?.auto_reply);

// Whether the business can still use its one revision on this reply. `request` = the opportunity's request
// (status/expires_at); when absent only the offer's own state decides.
export function canReviseOffer(offer, request = offer?.business_requests ?? null, now = new Date()) {
  if (!offer || offer.status !== 'offered' || isRevisedOffer(offer) || isAutomatic(offer)) return false;
  const t = now.getTime();
  if (ms(offer.valid_until) != null && ms(offer.valid_until) <= t) return false;
  if (request) {
    if (request.status && request.status !== 'open') return false;
    if (ms(request.expires_at) != null && ms(request.expires_at) <= t) return false;
  }
  const terms = revisableTerms(offer);
  return terms.price || terms.discount || terms.times > 0;
}

// The sheet's starting values: the reply's current terms.
export function revisionDraftFrom(offer) {
  return {
    price: num(offer?.offer_price),
    discount: num(offer?.discount_pct),
    time: offer?.proposed_time ?? null,
    timeAlt: offer?.proposed_time_alt ?? null,
  };
}

// Why this draft can't be sent yet (a key under ui.bizDash3.revise*), or null when it can.
//   priceHigher / discountLower: the price would go up; priceMissing / discountMissing: the field was emptied;
//   discountOverCap: above the business's cap; timePassed / sameTimes: item 119's time rules; unchanged: nothing differs.
export function revisionProblem(offer, draft, { now = new Date(), discountCap = null } = {}) {
  const terms = revisableTerms(offer);
  const price = num(draft?.price);
  const discount = num(draft?.discount);
  if (terms.price) {
    if (price == null || !Number.isFinite(price) || price < 0) return 'priceMissing';
    if (price > num(offer.offer_price)) return 'priceHigher';
  }
  if (terms.discount) {
    if (discount == null || !Number.isFinite(discount) || discount > 100) return 'discountMissing';
    if (discount < num(offer.discount_pct)) return 'discountLower';
    if (discountCap != null && discount > Number(discountCap)) return 'discountOverCap';
  }
  if (terms.times > 0) {
    const a = ms(draft?.time);
    const b = terms.times === 2 ? ms(draft?.timeAlt) : null;
    if (a == null || (terms.times === 2 && b == null)) return 'timePassed';
    if (a <= now.getTime() || (b != null && b <= now.getTime())) return 'timePassed';
    if (b != null && a === b) return 'sameTimes';
  }
  const params = revisionParams(offer, draft);
  const same = params.offer_price_param === num(offer.offer_price)
    && params.discount_pct_param === num(offer.discount_pct)
    && ms(params.proposed_time_param) === ms(offer.proposed_time)
    && ms(params.proposed_time_alt_param) === ms(offer.proposed_time_alt);
  return same ? 'unchanged' : null;
}

// What revise_business_offer receives: every revisable term, a term the reply never had stays null.
export function revisionParams(offer, draft) {
  const terms = revisableTerms(offer);
  const iso = (v) => (ms(v) == null ? null : new Date(v).toISOString());
  return {
    offer_id_param: offer?.id ?? null,
    offer_price_param: terms.price ? num(draft?.price) : null,
    discount_pct_param: terms.discount ? num(draft?.discount) : null,
    proposed_time_param: terms.times > 0 ? iso(draft?.time) : null,
    proposed_time_alt_param: terms.times === 2 ? iso(draft?.timeAlt) : null,
  };
}

// The customer's card as it will read after this revision (the sheet's live Customer Preview): the same row with the
// new terms and revision 1. Nothing about the old terms is carried.
export function revisedOfferPreview(offer, draft) {
  const p = revisionParams(offer, draft);
  const terms = revisableTerms(offer);
  return {
    ...offer,
    offer_price: terms.price ? p.offer_price_param : offer?.offer_price ?? null,
    discount_pct: terms.discount ? p.discount_pct_param : offer?.discount_pct ?? null,
    proposed_time: terms.times > 0 ? p.proposed_time_param : offer?.proposed_time ?? null,
    proposed_time_alt: terms.times === 2 ? p.proposed_time_alt_param : offer?.proposed_time_alt ?? null,
    revision: 1,
  };
}

// The server's refusal when an accept/confirm names a revision the offer no longer has (accept_business_offer,
// confirm_group_plan_offer). Screens re-read the offer and say it in the person's language instead of the raw text.
export const OFFER_CHANGED_MESSAGE = 'This offer just changed. Check the new terms.';
export function isOfferChangedError(e) {
  return String(e?.message ?? '').includes(OFFER_CHANGED_MESSAGE);
}
