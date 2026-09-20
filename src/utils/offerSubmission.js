// Item 83: how a business offer's background screening reads to its owner. Pure: state in, wording out.
// States are the real stored ones (`business_offer_submissions.status`, with a held row's human decision already
// folded in by get_my_offer_submissions): reviewing / in_review / published / needs_changes / unavailable / not_sent.

// Fixed policy-category vocabulary (same 13 as the screening table's CHECK) -> a plain phrase. The classifier's own
// free-text reasoning is never shown: only the category, so an explanation is always accurate and never invented.
export const CATEGORY_PHRASES = {
  illegal_drugs: 'illegal drugs',
  weapons: 'weapons',
  explosives: 'explosives',
  fraud_scams: 'fraud or scams',
  counterfeit_goods: 'counterfeit goods',
  sexual_exploitation: 'sexual exploitation',
  illegal_gambling: 'illegal gambling',
  dangerous_services: 'dangerous services',
  hate_extremist: 'hateful or extremist content',
  human_trafficking: 'human trafficking',
  unregulated_medical_claims: 'unverified medical claims',
  financial_scams: 'financial scams',
  business_impersonation: 'impersonating another business',
};

export function needsChangesExplanation(sub) {
  if (sub?.reason) return `${sub.reason} Edit your offer and send it again.`;
  const phrases = (sub?.matched_categories ?? []).map((c) => CATEGORY_PHRASES[c]).filter(Boolean);
  if (phrases.length > 0) {
    const list = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
    return `Your offer or its photo or video appears to involve ${list}, which Nearby doesn't allow. Edit your offer and send it again.`;
  }
  return "It didn't pass our content check. Edit your offer and send it again.";
}

// -> { headline, detail, tone: 'progress'|'success'|'warning'|'danger', actions: ('retry'|'edit'|'dismiss')[] }
export function submissionView(sub) {
  switch (sub?.status) {
    case 'reviewing':
      return { headline: 'Reviewing your offer…', detail: "It will be sent to the customer as soon as it clears. You don't need to wait here.", tone: 'progress', actions: [] };
    case 'in_review':
      return { headline: 'In review by our team', detail: "We'll send it once it's approved. This is usually quick.", tone: 'progress', actions: [] };
    case 'published':
      return { headline: 'Offer sent', detail: 'The customer can see it now.', tone: 'success', actions: ['dismiss'] };
    case 'needs_changes':
      return { headline: 'Needs changes', detail: needsChangesExplanation(sub), tone: 'danger', actions: ['edit', 'dismiss'] };
    case 'not_sent':
      return { headline: "Couldn't be sent", detail: sub.reason || 'The request may no longer be open.', tone: 'warning', actions: ['dismiss'] };
    case 'unavailable':
      return { headline: "We couldn't finish reviewing this", detail: 'Nothing was sent. Your offer is saved.', tone: 'warning', actions: ['retry', 'dismiss'] };
    default:
      return null;
  }
}

// A request with one of these still has an offer in flight, so the opportunity card must not offer a second send.
const IN_FLIGHT = ['reviewing', 'in_review', 'unavailable'];
export function inFlightRequestIds(subs) {
  return new Set((subs ?? []).filter((s) => IN_FLIGHT.includes(s.status)).map((s) => s.request_id));
}

export const hasReviewing = (subs) => (subs ?? []).some((s) => s.status === 'reviewing');

// The saved payload -> the offer editor's fields (for "Edit and resend"). Media is not restored: the stored path is a
// server file, not a local pick, so an owner who needs to change or re-attach media picks it again.
export function payloadToForm(p = {}) {
  return {
    offerType: p.offerType ?? 'standard',
    description: p.offerDescription ?? '',
    price: p.offerPrice != null ? String(p.offerPrice) : '',
    discount: p.discountPct != null ? String(p.discountPct) : '',
    perPerson: !!p.priceIsPerPerson,
    title: p.offerTitle ?? '',
    items: Array.isArray(p.includedItems) ? p.includedItems : [],
    redemption: p.redemptionInstructions ?? '',
    experienceId: p.experienceId ?? null,
  };
}
