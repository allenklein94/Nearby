// Migration 20270343: the server refuses to move a gathering's time while a business has a confirmed booking for it (hint
// 'gathering_time_booked'). That is an input problem with a known fix, not a service failure: say why and what to do (cancel the
// reservation first), never offer Try Again (it would fail the same way). Anything else returns null (the screen's usual error).
export function gatheringEditRefusal(error) {
  if (error?.hint === 'gathering_time_booked') {
    return { titleKey: 'ui.gatheringForm.edit.timeBooked', bodyKey: 'ui.gatheringForm.edit.timeBookedBody' };
  }
  return null;
}
