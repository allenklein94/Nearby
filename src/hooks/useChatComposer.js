import { useState } from 'react';

// Shared send-and-recover-on-failure logic for every chat-style composer
// in this app (1:1, gathering, community, business). Previously each of
// the 4 screens cleared its own composer before the network call resolved
// and swallowed a failure with no visible error, no retry, and the
// drafted text gone for good. This hook fixes that once, in one place:
// the composer is only cleared optimistically, and a failed send restores
// the exact text that was typed (so the same Send button retries it) and
// surfaces a real, visible error instead of silently dropping the
// message.
export default function useChatComposer(initialText = '') {
  const [text, setText] = useState(initialText);
  const [sendError, setSendError] = useState(null);

  // sendFn receives the trimmed body text and does the actual insert/RPC
  // (plus any screen-specific bookkeeping, e.g. optimistic list updates).
  // Throw from sendFn to signal failure; the draft is restored and a
  // visible error is set.
  async function send(sendFn) {
    const body = text.trim();
    if (!body) return;
    setText('');
    setSendError(null);
    try {
      await sendFn(body);
    } catch (e) {
      setText(body);
      setSendError("Couldn't send — check your connection and tap Send to try again.");
    }
  }

  return { text, setText, send, sendError, clearSendError: () => setSendError(null) };
}
