// Item 112 follow-up (CLAUDE.md, "the finished plan could have a living
// header... 🎂 Sarah's 30th Birthday, with extremely subtle motion"):
// two small pure helpers behind BusinessRequestDetailScreen's confirmed
// Plan summary header. Kept dependency-free and separately testable, same
// split this codebase already uses for other presentation helpers
// (intentResolverScoring.js's own split from intentResolver.js).

// A confirmed plan's own title (planChatInfo.title, sourced from
// composeCelebrationTitle() -- Item 84) already carries a trailing
// occasion icon baked into the string, e.g. "Sarah's Birthday 🎂". The
// living header renders its own separately-animated icon up front, so
// this strips a real trailing icon match to avoid literally doubling it
// ("🎂 Sarah's Birthday 🎂") -- the same double-icon bug class Item 104's
// formatUpcomingWorldItemLine() already had to guard against once.
export function stripTrailingCelebrationIcon(title, icon) {
  if (!title) return '';
  if (!icon) return title;
  const suffix = ` ${icon}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trimEnd() : title;
}

// A stable string that changes if and only if something about the plan
// summary genuinely changed (status advanced, it was retimed/relabeled,
// party size updated, etc.) -- the living header's animated icon uses this
// as its trigger. "Motion should happen when something changes" (the
// user's own words): rendering with the SAME key twice must never replay
// the animation, only a real, observed change may.
export function buildPlanHeaderChangeKey(summary) {
  if (!summary) return '';
  return [
    summary.statusKind ?? '',
    summary.title ?? '',
    summary.dateLabel ?? '',
    summary.timeLabel ?? '',
    summary.location ?? '',
    summary.partySize ?? '',
  ].join('|');
}
