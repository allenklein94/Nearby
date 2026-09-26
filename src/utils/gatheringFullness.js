// P1 remediation (CLAUDE.md, Aug 28 2026 Full Coherence Audit, item "🟠
// Fullness needs to be universal"): a real, shared gathering-card
// fullness contract, reused by every surface that recommends/ranks/
// browses gatherings, so a full gathering never silently ranks/renders
// with zero indication on one surface while another surface already
// shows it. capacity/approvedAttendees are already fetched everywhere a
// gathering flows through this app (SAFE_GATHERING_FIELDS/
// getNearbyGatherings/getGatheringById all already carry both) -- this is
// a pure, no-I/O rendering helper, not a new query, matching this file's
// own established "no invented numbers" convention: a gathering with no
// real capacity set (the common case today) correctly shows nothing at
// all, never a fabricated "unlimited spots" claim.
const ALMOST_FULL_THRESHOLD_RATIO = 0.2;
const ALMOST_FULL_MIN = 2;

// Deliberately always re-derives isFull/spotsLeft from capacity and the
// real approvedAttendees array rather than trusting a possibly-stale
// gathering.isFull field -- only getGatheringById() computes that field
// today; getNearbyGatherings()/searchGatherings() don't, so relying on it
// would silently read as "not full" everywhere except one screen.
// How many people are really going. Prefers the server's `approvedCount`
// (join_gathering counts every approved row) over the visible attendee rows,
// which are short by any blocked person RLS hides. Falls back to the visible
// rows only when the server count was not fetched.
export function attendeeTotal(gathering) {
  if (typeof gathering?.approvedCount === 'number') return gathering.approvedCount;
  if (Array.isArray(gathering?.approvedAttendees)) return gathering.approvedAttendees.length;
  return typeof gathering?.attendeeCount === 'number' ? gathering.attendeeCount : 0;
}

// CAPACITY = TOTAL PEOPLE INCLUDING THE HOST (owner decision 2026-09-26, migration 20270209). The host is never an attendee row,
// so this file is the ONE client place that adds them: people = approved guests + 1, guest limit = capacity - 1 (the server's
// _gathering_guest_limit). No other file may compare an attendee count against capacity directly.
export function peopleGoing(gathering, guests = attendeeTotal(gathering)) {
  return guests + 1;
}
export function guestLimit(capacity) {
  return capacity == null ? null : Math.max(capacity - 1, 0);
}
// `guests` lets a caller pass a better-known guest count (e.g. the larger of the server count and the visible rows).
export function isGatheringFull(gathering, guests = attendeeTotal(gathering)) {
  return gathering?.capacity != null && guests >= guestLimit(gathering.capacity);
}

// The party a business is asked to host for this gathering: mirrors the server's _gathering_party_size, the larger of the
// people going (guests + host) and the capacity. Never capacity + 1.
export function gatheringBusinessPartySize(gathering) {
  return Math.max(peopleGoing(gathering), gathering?.capacity ?? 0);
}

export function getGatheringFullness(gathering) {
  if (gathering?.capacity == null) return null;
  const attendeeCount = attendeeTotal(gathering);
  const people = peopleGoing(gathering, attendeeCount);
  const spotsLeft = Math.max(gathering.capacity - people, 0);
  const isFull = spotsLeft <= 0;
  const almostFullThreshold = Math.max(ALMOST_FULL_MIN, Math.ceil(gathering.capacity * ALMOST_FULL_THRESHOLD_RATIO));
  const almostFull = !isFull && spotsLeft <= almostFullThreshold;
  return { attendeeCount, people, capacity: gathering.capacity, spotsLeft, isFull, almostFull };
}

// One real, consistent label -- reused verbatim across every surface
// (Home's Nearby Right Now/Best Pick/Trending, Discover, Gatherings
// browse) so "full" never reads three different ways in three different
// places. Matches the wording AskBusinessScreen's own matched-availability
// banner and GatheringDetailScreen's own "almost full" nudge already use,
// rather than inventing a fourth phrasing.
export function gatheringFullnessLabel(gathering) {
  const f = getGatheringFullness(gathering);
  if (!f) return null;
  if (f.isFull) return '🔒 Full — Join Waitlist';
  if (f.almostFull) return `🔥 ${f.spotsLeft} spot${f.spotsLeft === 1 ? '' : 's'} left`;
  return `🟢 ${f.spotsLeft} spot${f.spotsLeft === 1 ? '' : 's'} left`;
}
