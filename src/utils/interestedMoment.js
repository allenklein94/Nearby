// Owner item 31 (2026-10-11, approved): the Interested -> Attending moment reflects CONFIRMED attendance, not a successful tap.
// It shows only when all hold:
//   - wasInterested: the person's Interested mark was on when they tapped to join (the stored mark the screen read),
//   - joinStatus: join_gathering answered 'approved' for this very tap (a pending request or a waitlist spot is not attending),
//   - storedStatus: the reload after the join reads the stored attendance as 'approved'.
// It is decided from THIS visit's own join (the screen keeps `{ wasInterested, joinStatus }` only in memory), so a reload, a
// reopen or a later visit never shows it again, and a host approving a pending request later never plays it. The server's
// clear_interested_on_join removes the Interested mark on every join (approved, pending or waitlisted): unchanged.
export function interestedToAttendingMoment({ wasInterested, joinStatus, storedStatus } = {}) {
  return wasInterested === true && joinStatus === 'approved' && storedStatus === 'approved';
}
