// Item 39 (owner, 2026-10-11): "A friend is nearby". The client's half of the parameters; the server's are in
// friend_nearby_params() (migration 20270296) and the journey checks they agree. Initial owner values, not immutable.
// The server decides who is nearby (mutual opt-in, accepted friends, no block, both fresh, < ~1 mi) and enforces the
// throttle again; the client only avoids sending fixes it would refuse.
export const FRIEND_NEARBY = {
  minReportIntervalMs: 5 * 60 * 1000, // at most one fix per 5 min...
  moveBypassMiles: 0.25, // ...unless the person moved at least this far
  readCacheMs: 60 * 1000, // Home re-reads on focus, but not more than once a minute (server allows 20 per 10 min)
};
