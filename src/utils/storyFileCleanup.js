// The Reports screen's one line about removed photo files that won't delete (20270391). Reads the server's counts only: no path or
// person reaches the app. Nothing failing = nothing shown. The file is unreadable to users either way; this is a storage problem.
const KIND_LABEL = {
  refused: 'Storage refused the key',
  rate_limited: 'Storage is limiting requests',
  server: 'Storage is returning errors',
  timeout: 'Storage is timing out',
  network: 'Storage could not be reached',
  no_response: 'No answer came back',
  still_present: 'Storage said done but the file is still there',
  unsafe_path: 'The file has an unsafe name',
  not_sent: 'The delete was not sent',
  other: 'Storage gave an unexpected answer',
};

export function storyFileCleanupNotice(status) {
  const failing = Number(status?.failing) || 0;
  if (!failing) return null;
  const kinds = Object.entries(status.kinds || {})
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => KIND_LABEL[kind] || KIND_LABEL.other);
  return {
    title: failing === 1 ? "1 removed photo file couldn't be deleted" : `${failing} removed photo files couldn't be deleted`,
    reasons: kinds.join(' · '),
    // only given-up files need a person; the rest are still retrying on their own
    canRetry: Number(status.gave_up) > 0,
  };
}
