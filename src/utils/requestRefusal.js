import { tr } from '../i18n/translate';

// Idea "384": a chosen posting asked of its own business that can no longer be bound (ended, full for the party, the business
// declines) or isn't that business's is refused by the server, nothing sent. An input problem, not a service failure (no Try
// Again: it would fail the same way), worded with the existing "No longer available".
// Idea "394" (20270344): a request for a time that has already passed (a stated day + time, or a gathering that has started) is
// refused the same way, worded with the existing "That time window has already passed."
export const POSTING_REFUSAL_HINTS = ['posting_unavailable', 'posting_mismatch'];
const REFUSAL_WORDS = {
  posting_unavailable: 'ui.actions.noLongerAvailable',
  posting_mismatch: 'ui.actions.noLongerAvailable',
  request_time_passed: 'ui.bizHelp.availability.passed',
};
export function requestRefusal(error) {
  const key = REFUSAL_WORDS[error?.hint];
  if (key) {
    const e = new Error(tr(key));
    e.code = error.hint;
    return e;
  }
  return new Error(error?.message);
}
