import { acceptedBookingState } from './acceptedBooking';

// Owner item 32 (2026-10-11): accepting a business's offer merges it INTO Your Plan. The decisions live here (pure, tested);
// the motion lives in motion/OfferToPlanMerge.js and the screen only wires them.
//
// Owner decisions (2026-10-11):
//   A. After the merge begins, scroll gently to the existing Your Plan card, only for the person's OWN successful accept,
//      and never once they have touched the screen. A business's reply never scrolls (item 23 stands).
//   B. Home is unchanged: business bookings stay in Plans, never in Home's Your Plans (item 33 stands).
//   C. One moment per action: when the accept also completes a multi-part plan, the merge plays and the separate
//      "plan comes together" glow (item 25 #4) is suppressed. No confetti, no second vibration (the morph's own success
//      vibration is the only one). Reduce Motion = the finished plan card at once. Plays once, only after the person's tap.

// Should the merge play now? Only for the offer the person just accepted on this visit (`justAcceptedOfferId`, set only
// after accept_business_offer succeeded), only once its STORED state says booked (the reload brought it back confirmed,
// never the tap alone; the same acceptedBookingState the card's heading reads), only where the plan card is on this screen (the primary request; an add-on has no plan card),
// and once per offer.
export function offerToPlanMergeNow({ justAcceptedOfferId = null, offer = null, hasPlanCard = false, played = null } = {}) {
  if (!justAcceptedOfferId || !offer || offer.id !== justAcceptedOfferId) return false;
  if (offer.status !== 'accepted' || acceptedBookingState(offer) !== 'booked' || !hasPlanCard) return false;
  return !(played && played.has(offer.id));
}

// Where (and whether) to scroll so the plan card is seen receiving the booking. Null = do not scroll: the person touched
// the screen since the accept (their hand wins), the card's position is unknown, or its top is already in view.
// Reduce Motion jumps there at once (`animated: false`): the finished plan card, immediately.
export function planMergeScroll({ planY = null, scrollY = 0, interrupted = false, reduceMotion = false, gap = 0 } = {}) {
  if (interrupted || planY == null || !Number.isFinite(planY)) return null;
  const target = Math.max(planY - gap, 0);
  if (target >= (scrollY ?? 0)) return null; // the card's top is already on screen (it sits above the offers)
  return { y: target, animated: !reduceMotion };
}

// Item 25 #4 vs item 32 (decision C): the plan-comes-together moment yields to the merge when both come from one accept.
export function planTogetherYieldsToMerge({ mergeOwnAccept = false } = {}) {
  return !!mergeOwnAccept;
}

// The travel's path, in the scroll view's content coordinates (so a scroll during it carries both ends along). The plan
// card's content position comes from its own layout (`planContentY`); the accepted card's is that plus the on-screen
// distance between the two (both measured in the window at the same instant). Null when anything is unknown, or when the
// layout is not the expected one (the plan card above the offers): the merge then lands without a travel.
export function mergeTravelPath({ fromWindowY = null, toWindowY = null, planContentY = null } = {}) {
  if (![fromWindowY, toWindowY, planContentY].every((v) => v != null && Number.isFinite(v))) return null;
  if (toWindowY >= fromWindowY) return null;
  return { fromY: planContentY + (fromWindowY - toWindowY), toY: planContentY };
}
