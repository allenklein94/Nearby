// Idea "193" gap 2 (owner, 2026-10-18): one booking at a time on a request screen. While ANY offer is being booked, every
// "I'll take this one" is unavailable: the tapped one shows the spinner, every other one is visibly disabled (they were
// already refused by the screen's single in-flight lock, but looked tappable). When the booking finishes, success or
// failure, the in-flight id clears and each button follows the reloaded, server-confirmed offer state again.
// actingOfferId = the offer being booked (null = none); bookable = item 119's canBookWith for this offer.
export function offerAcceptButtonState(offerId, actingOfferId, bookable) {
  const busy = actingOfferId != null && actingOfferId === offerId;
  const lockedByOther = actingOfferId != null && actingOfferId !== offerId;
  return { busy, disabled: busy || lockedByOther || !bookable, dimmed: lockedByOther || !bookable };
}
