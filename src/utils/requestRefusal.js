import { tr } from '../i18n/translate';

// Idea "384": a chosen posting asked of its own business that can no longer be bound (ended, full for the party, the business
// declines) or isn't that business's is refused by the server, nothing sent. An input problem, not a service failure (no Try
// Again: it would fail the same way), worded with the existing "No longer available".
export const POSTING_REFUSAL_HINTS = ['posting_unavailable', 'posting_mismatch'];
export function requestRefusal(error) {
  if (POSTING_REFUSAL_HINTS.includes(error?.hint)) {
    const e = new Error(tr('ui.actions.noLongerAvailable'));
    e.code = error.hint;
    return e;
  }
  return new Error(error?.message);
}
