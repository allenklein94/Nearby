import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  dismissRecommendedGathering, undoDismissRecommendedGathering, notInterestedSession, subscribeNotInterested,
} from '../services/notInterested';
import { canDismissRecommendation, dismissLowersKind, hiddenRecommendationIds } from '../utils/notInterested';
import { presentRecoverableError } from '../utils/recoverableError';

// "Not interested" state for one surface (owner idea "153"; the rules live in utils/notInterested.js). `feedback` is the
// surface's get_my_experience_feedback read; `interestedIds` its Interested set (null = unknown = no menu).
// The card is replaced at once (no motion) by its line; the line's wording comes from the gathering's kind and is
// corrected by the server's answer; a failed write puts the card back and says so. Undo puts the card back at once.
export default function useNotInterested({ myUserId, interestedIds, feedback }) {
  const [, setTick] = useState(0);
  useEffect(() => subscribeNotInterested(() => setTick((n) => n + 1)), []);
  const [menuId, setMenuId] = useState(null);
  const [lines, setLines] = useState({}); // gathering id -> { kindDownRanked }
  const busy = useRef(new Set());

  const hidden = hiddenRecommendationIds(feedback, notInterestedSession(), Object.keys(lines));
  const eligible = (g) => canDismissRecommendation(g, { myUserId, interestedIds });
  const toggleMenu = (id) => setMenuId((cur) => (cur === id ? null : id));
  const removeLine = (id) => setLines((l) => { const n = { ...l }; delete n[id]; return n; });

  const dismiss = useCallback(async (g) => {
    if (!g?.id || busy.current.has(g.id)) return;
    busy.current.add(g.id);
    setMenuId(null);
    setLines((l) => ({ ...l, [g.id]: { kindDownRanked: dismissLowersKind(g) } }));
    try {
      const { kindDownRanked } = await dismissRecommendedGathering(g.id, g.interest_tag ?? null);
      setLines((l) => (l[g.id] ? { ...l, [g.id]: { kindDownRanked } } : l));
    } catch (e) {
      removeLine(g.id);
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => dismiss(g) });
    } finally {
      busy.current.delete(g.id);
    }
  }, []);

  const undo = useCallback(async (g) => {
    if (!g?.id || busy.current.has(g.id)) return;
    busy.current.add(g.id);
    const previous = lines[g.id];
    removeLine(g.id);
    try {
      await undoDismissRecommendedGathering(g.id);
    } catch (e) {
      if (previous) setLines((l) => ({ ...l, [g.id]: previous }));
      presentRecoverableError(Alert, { what: 'undo that', error: e, onRetry: () => undo(g) });
    } finally {
      busy.current.delete(g.id);
    }
  }, [lines]);

  return {
    hidden,
    eligible,
    menuOpen: (id) => menuId === id,
    toggleMenu,
    line: (id) => lines[id] ?? null,
    dismiss,
    undo,
  };
}
