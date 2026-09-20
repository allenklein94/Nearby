import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { formDrafts } from '../services/formDrafts';

// Item 82. `snapshot` is a plain JSON-able object of the form's fields; `isEmpty(snapshot)` says nothing worth keeping
// has been typed yet (an empty form never overwrites a saved draft). On mount the saved draft, if any, is exposed as
// `draft` -- it is NOT applied automatically: the person chooses "Continue editing" (`restore`) or "Start over"
// (`discard`). Saving is debounced and only starts once that first load has resolved, so a blank form cannot wipe the
// draft before it was offered. `clear()` after a successful send.
export default function useFormDraft(name, snapshot, { isEmpty = () => false, enabled = true, debounceMs = 800 } = {}) {
  const [userId, setUserId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [ready, setReady] = useState(false);
  const timer = useRef(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setDraft(null);
    if (!enabled || !name) return undefined;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const id = data?.session?.user?.id ?? null;
        if (cancelled) return;
        setUserId(id);
        const found = id ? await formDrafts.load(id, name) : null;
        if (!cancelled) setDraft(found);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [name, enabled]);

  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (!enabled || !ready || !userId || draft) return undefined; // an unanswered draft is never overwritten
    if (isEmpty(latest.current)) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { formDrafts.save(userId, name, latest.current); }, debounceMs);
    return () => clearTimeout(timer.current);
  }, [serialized, enabled, ready, userId, draft, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = useCallback((apply) => {
    if (draft) apply(draft.data);
    setDraft(null);
  }, [draft]);
  const discard = useCallback(async () => {
    setDraft(null);
    if (userId) await formDrafts.clear(userId, name);
  }, [userId, name]);
  const clear = useCallback(async () => {
    clearTimeout(timer.current);
    if (userId) await formDrafts.clear(userId, name);
  }, [userId, name]);

  return { draft, restore, discard, clear };
}
