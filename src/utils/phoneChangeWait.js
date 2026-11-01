// The app's side of 20270375's number-change rule (revised 2026-11-01): a phone number can be changed only from a session
// (this device's sign-in) that has existed for 7 days, plus a fresh code to the current number (utils/accountStepUp.js).
// The SERVER decides (get_my_phone_change_wait reads the calling session; the auth.users guard stays the final authority);
// the app asks first so the person is told when. Before 0375 is live the function doesn't exist: the app goes on as before.

// The RPC result -> the time a change becomes possible (a Date in the future), or null = go ahead.
// Missing function (PGRST202, before 0375) or any other read failure = null: the guard still refuses a too-early change.
export function phoneChangeWaitUntil(result, now = Date.now()) {
  if (!result || result.error || result.data == null) return null;
  const until = new Date(result.data);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now) return null;
  return until;
}

// "{time}" for the message: date + clock in the phone's own locale (a wait is at most 7 days away).
export function phoneChangeWaitTime(until) {
  return until.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
