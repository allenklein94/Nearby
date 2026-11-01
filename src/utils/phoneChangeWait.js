// The app's side of 20270375's number-change rule: a phone number can be changed only 24 hours after the account's latest
// sign-in (a fresh sign-in = maybe someone with a stolen code). The SERVER decides (get_my_phone_change_wait, the same
// rule as the auth.users guard, which stays the final authority); the app asks first so the person is told when, instead
// of sending a code that can't work. Before 0375 is live the function doesn't exist: the app then goes on as it always did.

// The RPC result -> the time a change becomes possible (a Date in the future), or null = go ahead.
// Missing function (PGRST202, before 0375) or any other read failure = null: the guard still refuses a too-early change.
export function phoneChangeWaitUntil(result, now = Date.now()) {
  if (!result || result.error || result.data == null) return null;
  const until = new Date(result.data);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now) return null;
  return until;
}

// "{time}" for the message: weekday + clock in the phone's own locale (a wait is at most a day away).
export function phoneChangeWaitTime(until) {
  return until.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
