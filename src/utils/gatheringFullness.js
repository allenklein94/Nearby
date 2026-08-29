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
export function getGatheringFullness(gathering) {
  if (gathering?.capacity == null) return null;
  const attendeeCount = gathering.approvedAttendees?.length
    ?? (typeof gathering.attendeeCount === 'number' ? gathering.attendeeCount : 0);
  const spotsLeft = Math.max(gathering.capacity - attendeeCount, 0);
  const isFull = spotsLeft <= 0;
  const almostFullThreshold = Math.max(ALMOST_FULL_MIN, Math.ceil(gathering.capacity * ALMOST_FULL_THRESHOLD_RATIO));
  const almostFull = !isFull && spotsLeft <= almostFullThreshold;
  return { attendeeCount, capacity: gathering.capacity, spotsLeft, isFull, almostFull };
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
