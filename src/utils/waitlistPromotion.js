// Owner item 143 (2026-10-16, approved): being moved from the waitlist into Attending is a confirmed change of attendance, so
// GatheringDetail shows item 31's row as "~~On waitlist~~ -> ✓ Attending" (same component, existing labels, one glow) the
// first time the person opens that gathering afterwards. It shows only when all hold:
//   - storedStatus: the attendance the screen just read is 'approved' (attending now),
//   - promotion: the server's own record of THAT attendance going waitlisted -> approved (get_my_waitlist_promotion,
//     migration 20270319), never inferred from a push, a count or a previous screen,
//   - promotion.seen_at is empty: it has not been shown before (the screen stamps it when it shows the moment).
// Never for a normal join, a join request, or waitlisted -> pending (an approval-needed gathering's "Requested"): the server
// records no promotion for those. The screen keeps the decision for the rest of the visit, so a reload never flips it.
export function waitlistPromotionMoment({ storedStatus, promotion } = {}) {
  return storedStatus === 'approved' && !!promotion?.promoted_at && !promotion.seen_at;
}

// The spoken line, from the two existing labels (no new strings): "On waitlist, Attending".
export function waitlistPromotionA11y(onWaitlistLabel, attendingLabel) {
  const strip = (s) => String(s ?? '').replace(/^[✓★]\s*/u, '').trim();
  return [strip(onWaitlistLabel), strip(attendingLabel)].filter(Boolean).join(', ');
}
