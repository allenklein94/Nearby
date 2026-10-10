// The accepted offer card's heading and facts (owner item 12, 2026-10-10). "You're booked" is the locked booking wording
// (items 122/123), so it is shown ONLY when a reservation is really confirmed. accept_business_offer confirms one in the
// same transaction (provider 'nearby'), but the reservation status also allows 'requested' and 'failed' (a future outside
// provider), and the group-plan accept path writes no reservation at all, so the card reads what was actually stored:
//   confirmed -> 'booked'      "You're booked" (with the ✓)
//   requested -> 'confirming'  "Offer accepted · confirming your booking"
//   failed    -> 'not_through' "Offer accepted · the booking didn't go through"
//   no row    -> 'accepted'    "Offer accepted"
// A completed offer was booked and redeemed; it keeps its own "Completed" status and never reaches this card.
export function acceptedBookingState(offer) {
  const status = offer?.business_reservations?.[0]?.status ?? null;
  if (status === 'confirmed') return 'booked';
  if (status === 'requested') return 'confirming';
  if (status === 'failed') return 'not_through';
  return 'accepted';
}

export const ACCEPTED_TITLE_KEY = {
  booked: 'ui.requestDetail.youreBooked',
  confirming: 'ui.requestDetail.booking.confirming',
  not_through: 'ui.requestDetail.booking.notThrough',
  accepted: 'ui.requestDetail.booking.accepted',
};

// The when line: the business's accepted alternative time if it proposed one, else the request's own day and time.
// Only real parts; nothing at all when neither is known (never "Date not set" on a booked card).
export function acceptedWhenLine({ proposedTimeLabel = null, dateLabel = null, timeLabel = null } = {}) {
  if (proposedTimeLabel && String(proposedTimeLabel).trim()) return proposedTimeLabel;
  const parts = [dateLabel, timeLabel].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(' · ') : null;
}

// Party size the customer gave (total people). Unknown or not a positive whole number = no line.
export function acceptedPartySize(request) {
  const n = Number(request?.party_size);
  return Number.isInteger(n) && n > 0 ? n : null;
}
