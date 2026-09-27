// Owner item 113: a temporary intent is not a preference. "Find me dinner tonight" is a TEMPORARY INTENT: it stops being
// active once the time it named is over. "I like coffee" is a PERSISTENT PREFERENCE: a declared interest
// (profiles.interests), changed only by the person. Nothing here ever writes a preference, and a typed ask never becomes one
// (the private "What Nearby has noticed" affinity from searches is a separate, forgettable signal, item 95, and never an
// interest without the person's own tap).
//
// The only place a typed ask stays active across time is Discover's saved session (services/discoverSession.js + its account
// sync). This is the ONE rule for when it ends, read from the time the words named (classification.dateWindow, words only):
//   now / today / tonight -> 4 AM the next morning (a late "tonight" is still tonight; same cut-off as Free tonight)
//   tomorrow             -> 4 AM the morning after tomorrow
//   weekend              -> 4 AM the Monday after that weekend
//   no time word         -> no time-based end (the 180-day raw-ask retention still applies)
// Local time of the device that reads it, measured from when the ask was made (askedAt), which never moves on refinement.
const CUTOFF_HOUR = 4;

function morningAfter(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, CUTOFF_HOUR, 0, 0, 0);
  return d.getTime();
}

// ms timestamp when the intent is over, or null when it names no time.
export function intentExpiresAt(dateWindow, askedAt) {
  if (!Number.isFinite(askedAt)) return null;
  const asked = new Date(askedAt);
  // Asked after midnight but before the cut-off counts as the previous evening ("tonight" at 1 AM).
  const day = asked.getHours() < CUTOFF_HOUR ? new Date(asked.getFullYear(), asked.getMonth(), asked.getDate() - 1) : asked;
  switch (dateWindow) {
    case 'now':
    case 'today':
    case 'tonight':
      return morningAfter(day, 1);
    case 'tomorrow':
      return morningAfter(day, 2);
    case 'weekend': {
      const dow = day.getDay(); // 0 Sun .. 6 Sat
      const toMonday = dow === 0 ? 1 : 8 - dow;
      return morningAfter(day, toMonday);
    }
    default:
      return null;
  }
}

export function isIntentExpired(classifyResult, askedAt, now = Date.now()) {
  const end = intentExpiresAt(classifyResult?.dateWindow ?? null, askedAt);
  return end != null && now >= end;
}
