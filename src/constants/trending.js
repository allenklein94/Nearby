// "Trending" is a claim about real attendance. A gathering is only trending when at least this many approved attendees
// are going -- half of the fit-score formula's own attendance cap, so it is grounded in an existing number. Shared by
// Discover and Home so both surfaces mean the same thing by the word (global rule 7: the UI agrees with the data).
export const TRENDING_ATTENDANCE_MIN = 5;

// Trending needs established attendees (owner, 2026-11-11; migration 20270409). The server alone decides it: at least
// TRENDING_ATTENDANCE_MIN approved attendees whose accounts are Established (verified phone + account age, not suspended),
// never the host, returned as ONE yes/no value (`trending` from get_gathering_approved_counts, carried as `isTrending`).
// The phone never compares the attendee count against 5 for Trending any more: five brand-new accounts can make a count, not a
// trend. A missing value (an older database, a failed read) means NOT trending, never a guess. The "N attending" figure, capacity
// and the popularity ranking keep reading the full approved count (attendeeTotal); only the Trending claim reads this.
export function isTrendingGathering(gathering) {
  return gathering?.isTrending === true;
}
