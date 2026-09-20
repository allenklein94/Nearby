// Sponsored Spotlight business terms (item 44). The text is versioned and IMMUTABLE per version: a change to any word
// needs a new version string, a new sponsored_terms_versions row (its sha256) and a new Jest-recorded hash. What a
// business accepts is recorded server-side against the version, so we can show exactly which text was agreed.
// DRAFT: counsel has not approved this text, so nothing may go live on it (design section 16). Bracketed counsel items
// from PRODUCT_AUDIT/SPONSORED_BUSINESS_TERMS_DRAFT_2026-09-20.md are NOT product text and are not included.
export const SPONSORED_TERMS_VERSION = 'v1-draft-1';

export const SPONSORED_TERMS_SECTIONS = [
  ['What you are buying', 'A Sponsored Spotlight is one paid placement for your business or one of your offers, shown for 7 consecutive days, starting on the date you choose, in the Places or Perks browse tabs to people within 10 miles of your business address who are browsing your category. It is always labeled "Sponsored". The price is $25 (USD) per 7-day placement, charged once through Stripe Checkout. It does not renew automatically.'],
  ['What we do not promise', 'No number of views, taps, visits or customers. Each person sees your spotlight at most once every 7 days, and some people will never see it. Only one business per category per local area can hold a spotlight at a time, first paid, first served. Reported views and taps are approximate.'],
  ['Your content', 'You provide a headline and an optional description. It is reviewed automatically before payment and may be refused. You confirm you have the right to use it and that it is accurate, lawful and not misleading. We may pause or remove a spotlight that breaks these terms or that people report.'],
  ['Cancellation and refunds', 'Before your start date you can cancel in the app for a full refund. After it starts there is no refund for days already shown. If Nearby materially fails to deliver, you are refunded the undelivered days at $25 divided by 7 per day, rounded up to the cent in your favor. Low or no views are not a failure. Refunds return to the original payment method.'],
  ['Payment', 'Payment is processed by Stripe. Nearby does not see or store your card details.'],
  ['People\'s data', 'We use only the person\'s current location and the category they are browsing to decide who sees a spotlight. You receive totals only, never who saw or tapped it.'],
  ['Who accepts', 'By ticking the box you accept these terms on behalf of the business you are authorized to manage.'],
];

export const SPONSORED_TERMS_TEXT = SPONSORED_TERMS_SECTIONS.map(([h, b]) => `${h}\n${b}`).join('\n\n');
