// Migration 20270343: the server refuses to move a gathering's time while a business has a confirmed booking for it (hint
// 'gathering_time_booked'). Idea "394" (20270344): it also refuses while businesses have replied to the gathering's open request
// (hint 'gathering_request_has_replies'; an unanswered request just follows the new time). Both are input problems with a known
// fix, not service failures: say why and what to do (cancel the reservation / the request first), never offer Try Again (it would
// fail the same way). Anything else returns null (the screen's usual error).
const REFUSALS = {
  gathering_time_booked: { titleKey: 'ui.gatheringForm.edit.timeBooked', bodyKey: 'ui.gatheringForm.edit.timeBookedBody' },
  gathering_request_has_replies: { titleKey: 'ui.gatheringForm.edit.requestReplied', bodyKey: 'ui.gatheringForm.edit.requestRepliedBody' },
};
export function gatheringEditRefusal(error) {
  return REFUSALS[error?.hint] ?? null;
}
