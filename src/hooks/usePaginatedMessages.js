import { useState, useCallback, useRef } from 'react';

export const MESSAGE_PAGE_SIZE = 50;

// Shared cursor-based pagination for every chat-style screen in this app
// (1:1, gathering, community, business). Each of these used to fetch a
// conversation's *entire* history on every load — see the Aug 10 2026
// scalability audit (PRODUCT_AUDIT/SCALABILITY_AUDIT.md) — which only gets
// worse the longer a conversation lives. This hook owns the cursor/
// loading-state bookkeeping; the actual Supabase query shape (table,
// joins) differs per surface, so each caller supplies its own
// fetchPage({ limit, beforeCreatedAt }) returning rows in DESCENDING
// created_at order (newest first).
//
// Messages stay in DESC order the whole time on purpose — it matches
// FlatList's `inverted` prop directly (index 0 renders at the visual
// bottom, i.e. "most recent"), so neither the initial render nor a
// load-older append needs to reverse anything. A newly-arrived realtime
// message is always the newest, so it goes at the front; loading older
// history appends to the end.
export default function usePaginatedMessages(fetchPage) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  // Gap fix (PRODUCT_AUDIT-flagged, Aug 14 2026): every fetchPage() this
  // hook is handed (the four chat-style screens' own Supabase queries)
  // used to swallow a real query error into `console.error` + an empty
  // array — indistinguishable, from this hook's point of view, from a
  // genuinely empty conversation or a genuinely exhausted history. Each
  // fetchPage() now throws instead of swallowing (see ChatScreen.js /
  // gatheringChat.js / communities.js / brandOffers.js), and this hook
  // catches it here, once, for all four callers — same "fix it once, in
  // one shared place" precedent this hook itself was already built under.
  const [loadError, setLoadError] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState(false);
  const messagesRef = useRef([]);
  const loadingOlderRef = useRef(false);

  const setMessagesTracked = useCallback((updater) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setLoadingInitial(true);
    setLoadError(false);
    try {
      const page = await fetchPage({ limit: MESSAGE_PAGE_SIZE, beforeCreatedAt: null });
      setHasMore(page.length === MESSAGE_PAGE_SIZE);
      setMessagesTracked(page);
    } catch (e) {
      console.error('usePaginatedMessages loadInitial failed', e);
      setLoadError(true);
    }
    setLoadingInitial(false);
  }, [fetchPage, setMessagesTracked]);

  // Called from FlatList's onEndReached — in inverted-list terms, that's
  // the user scrolling toward the *oldest* end of the conversation.
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore) return;
    const oldest = messagesRef.current[messagesRef.current.length - 1];
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setLoadOlderError(false);
    try {
      const page = await fetchPage({ limit: MESSAGE_PAGE_SIZE, beforeCreatedAt: oldest.created_at });
      setHasMore(page.length === MESSAGE_PAGE_SIZE);
      setMessagesTracked((prev) => [...prev, ...page]);
    } catch (e) {
      console.error('usePaginatedMessages loadOlder failed', e);
      setLoadOlderError(true);
    }
    setLoadingOlder(false);
    loadingOlderRef.current = false;
  }, [fetchPage, hasMore, setMessagesTracked]);

  // A new message arriving via a realtime INSERT event — always the
  // newest, so it goes at the front, deduped by id in case of overlap
  // with an in-flight page fetch.
  const prependMessage = useCallback((message) => {
    setMessagesTracked((prev) => (prev.some((m) => m.id === message.id) ? prev : [message, ...prev]));
  }, [setMessagesTracked]);

  const updateMessage = useCallback((message) => {
    setMessagesTracked((prev) => prev.map((m) => (m.id === message.id ? message : m)));
  }, [setMessagesTracked]);

  const removeMessage = useCallback((messageId) => {
    setMessagesTracked((prev) => prev.filter((m) => m.id !== messageId));
  }, [setMessagesTracked]);

  return {
    messages,
    setMessages: setMessagesTracked,
    loadInitial,
    loadOlder,
    prependMessage,
    updateMessage,
    removeMessage,
    hasMore,
    loadingOlder,
    loadingInitial,
    loadError,
    loadOlderError,
  };
}
