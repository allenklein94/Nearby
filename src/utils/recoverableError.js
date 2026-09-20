// Item 81: an error is never a dead end, and a backend failure never costs the person their work. Two kinds:
//   service failure (network, timeout, 5xx, the screening service being down): nothing the person did wrong ->
//     "We couldn't {what} right now. Your draft is saved." + Try Again (re-runs the same action with the same draft).
//   input problem (the server refused THIS content: over the cap, a rule): retrying the same thing would fail the same
//     way, so the message says what to change and offers no Try Again.
// The draft claim is only made by callers whose form really stays populated on failure (state is cleared on success only).

export function serviceError(response, result, fallback) {
  const e = new Error(result?.error || fallback);
  e.status = response?.status ?? null;
  e.code = result?.code ?? null;
  return e;
}

const NETWORK = /network request failed|failed to fetch|network error|timed? ?out|offline|internet|connection/i;
const RETRYABLE_TEXT = /try again|right now|unavailable|temporar/i;

export function isServiceFailure(e) {
  if (!e) return false;
  if (e.code === 'screening_unavailable') return true;
  if (typeof e.status === 'number' && (e.status >= 500 || e.status === 429 || e.status === 408)) return true;
  const msg = String(e.message ?? '');
  return NETWORK.test(msg) || (e.name === 'TypeError' && /fetch|network/i.test(msg)) || RETRYABLE_TEXT.test(msg);
}

export function isOffline(e) {
  return NETWORK.test(String(e?.message ?? ''));
}

// { title, message, canRetry } -- pure, so every surface says it the same way.
export function recoverableErrorCopy({ what, error, draftKept = false }) {
  if (isServiceFailure(error)) {
    const parts = [];
    if (isOffline(error)) parts.push('Check your connection.');
    parts.push(draftKept ? 'Your draft is saved.' : 'Nothing was lost. Please try again.');
    return { title: `We couldn't ${what} right now.`, message: parts.join(' '), canRetry: true };
  }
  const detail = String(error?.message ?? '').trim();
  return { title: "That didn't go through", message: detail || `We couldn't ${what}. Please check it and try again.`, canRetry: false };
}

export function presentRecoverableError(Alert, { what, error, draftKept = false, onRetry }) {
  const copy = recoverableErrorCopy({ what, error, draftKept });
  if (copy.canRetry && typeof onRetry === 'function') {
    Alert.alert(copy.title, copy.message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Try Again', onPress: onRetry },
    ]);
  } else {
    Alert.alert(copy.title, copy.message);
  }
  return copy;
}
