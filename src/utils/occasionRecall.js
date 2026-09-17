// Item 101 (CLAUDE.md, "Occasions can become recurring"). Pure, dependency-
// free formatting over the real jsonb shape get_occasion_recall() returns
// (src/services/occasions.js's getOccasionRecall) -- same split-out-for-
// testability precedent as occasionPackageFormatting.js/businessRequestWhen.js.
// Never fabricates a detail the recall doesn't actually carry -- every line
// below is honestly omitted, not guessed, when the underlying field is null.
//
// Deliberately does NOT import formatOfferSummary() (businessFulfillment.js)
// even though its price formatting is identical -- that file transitively
// imports supabase/expo-location/react-native and can't be imported in a
// plain Jest/Node test at all (same reasoning intentResolverScoring.js's
// own header comment gives for its own split from intentResolver.js). The
// two-line price format is small enough to duplicate honestly rather than
// drag in that whole file.

// A short "what you remember" line for a business-destined recall, e.g.
// "Bella Trattoria · $65.00/person · 7:00 PM".
export function formatOccasionRecallSummary(recall) {
  if (!recall || recall.planType !== 'business') return null;
  const parts = [];
  if (recall.partnerName) parts.push(recall.partnerName);
  if (recall.offer_price != null) {
    parts.push(`$${Number(recall.offer_price).toFixed(2)}${recall.price_is_per_person ? '/person' : ''}`);
  }
  if (recall.proposedTime) {
    const t = new Date(recall.proposedTime);
    if (!Number.isNaN(t.getTime())) {
      parts.push(t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// A real, honest "you liked it" line -- only ever rendered when a genuine
// business_offer_outcomes row exists with a real positive rating, never
// inferred or defaulted. A negative/neutral/missing rating renders nothing
// here rather than a fabricated "you liked it."
export function occasionRecallLikedText(recall) {
  if (!recall || recall.planType !== 'business') return null;
  if (recall.satisfactionRating === 'loved_it') return "You loved it last time!";
  if (recall.satisfactionRating === 'good' && recall.wouldRepeat !== 'no') return 'You liked it last time.';
  return null;
}
