// Item 83: how a business offer's background screening reads to its owner. Pure: state in, wording out.
import { replySentConfirmation } from './actionConfirmations';
import { tr } from '../i18n/translate';
import { joinAnd } from '../i18n/list';
import { videoProblemText } from './videoProblem';

const U = (key, vars) => tr(`ui.bizHelp.submission.${key}`, vars);
// States are the real stored ones (`business_offer_submissions.status`, with a held row's human decision already
// folded in by get_my_offer_submissions): reviewing / in_review / published / needs_changes / unavailable / not_sent.

// Fixed policy-category vocabulary (same 13 as the screening table's CHECK) -> a plain phrase. The classifier's own
// free-text reasoning is never shown: only the category, so an explanation is always accurate and never invented.
// English source of the phrases (kept for tests and the stored-key list); shown through ui.bizHelp.submission.category.<key>.
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
  // sub.reason is the server's own validation message, shown as written.
  if (sub?.reason) return U('reasonThenEdit', { reason: videoProblemText(sub.reason) });
  const phrases = (sub?.matched_categories ?? []).filter((c) => CATEGORY_PHRASES[c]).map((c) => U(`category.${c}`));
  if (phrases.length > 0) return U('involves', { list: joinAnd(phrases) });
  return U('didntPass');
}

// -> { headline, detail, tone: 'progress'|'success'|'warning'|'danger', actions: ('retry'|'edit'|'dismiss')[] }
export function submissionView(sub) {
  switch (sub?.status) {
    case 'reviewing':
      return { headline: U('reviewingTitle'), detail: U('reviewingBody'), tone: 'progress', actions: [] };
    case 'in_review':
      return { headline: U('inReviewTitle'), detail: U('inReviewBody'), tone: 'progress', actions: [] };
    case 'published': {
      // Named by the reply's real kind from its saved payload (item 121/123): a plain reply is "Reply sent", never "Offer sent".
      const p = sub.payload ?? {};
      const [headline] = replySentConfirmation({ offer_type: p.offerType, offer_title: p.offerTitle, offer_price: p.offerPrice, discount_pct: p.discountPct, included_items: p.includedItems });
      return { headline, detail: U('publishedBody'), tone: 'success', actions: ['dismiss'] };
    }
    case 'needs_changes':
      return { headline: U('needsChangesTitle'), detail: needsChangesExplanation(sub), tone: 'danger', actions: ['edit', 'dismiss'] };
    case 'not_sent':
      return { headline: U('notSentTitle'), detail: sub.reason || U('notSentBody'), tone: 'warning', actions: ['dismiss'] };
    case 'unavailable':
      return { headline: U('unavailableTitle'), detail: U('unavailableBody'), tone: 'warning', actions: ['retry', 'dismiss'] };
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
