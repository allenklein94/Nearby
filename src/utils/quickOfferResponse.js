// The three-tap business response: Accept -> "Standard availability" (one tap) or "Special offer" (the full offer editor),
// Offer Alternative (a different time), Decline (reason picker). The server requires a non-empty description on every
// response, so the quick paths send a fixed, factual line the owner's own tap produces -- never AI text, never invented terms.
export const STANDARD_AVAILABILITY_TEXT = 'We can accommodate this as requested.';

const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;

// The owner's usual terms from their standing fulfillment policy, as a customer-facing sentence -- or null when they have
// none worth sending. Deliberately ONLY terms that are honest to send: minimum spend per person and the cancellation window.
// NOT the deposit (the policy editor says it is "stored only -- not charged", so promising it to a customer would claim
// something the app does not do) and NOT max_discount_pct (a ceiling the business will go to, not something it is offering).
export function usualTermsLine(policy) {
  const parts = [];
  if (policy?.min_spend_per_person != null && Number(policy.min_spend_per_person) > 0) {
    parts.push(`${money(policy.min_spend_per_person)} per person minimum spend`);
  }
  if (policy?.cancellation_window_hours != null && Number(policy.cancellation_window_hours) > 0) {
    parts.push(`cancellation window: ${Number(policy.cancellation_window_hours)} hour${Number(policy.cancellation_window_hours) === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? `Our usual terms: ${parts.join('; ')}.` : null;
}

// What "Standard availability" sends: the fixed line plus the owner's own usual terms when they have set any.
export function standardAvailabilityText(policy) {
  const terms = usualTermsLine(policy);
  return terms ? `${STANDARD_AVAILABILITY_TEXT} ${terms}` : STANDARD_AVAILABILITY_TEXT;
}

export function buildAlternativeText(note) {
  const n = (note ?? '').trim();
  const base = "We can't do the requested time, but we can do this time instead.";
  return n ? `${base} ${n}`.slice(0, 1000) : base;
}

// Where the "another time" picker opens: the request's own date/time when it has one (so the owner scrolls from there),
// otherwise now. Only ever a starting point -- the owner must pick a time; nothing is submitted from this default.
export function alternativePickerStart(request, now = new Date()) {
  if (request?.date) {
    const d = new Date(`${request.date}T${request.time_window_start ?? '12:00:00'}`);
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) return d;
  }
  return now;
}
