import { useCallback, useRef, useState } from 'react';
import { checkBusinessSettingConflicts } from '../services/brandOffers';
import { applyRecheck, clearConflict, reportConflict, settingConflictsOf } from '../utils/settingConflicts';

// Inline conflict messages for the business editors (item 86). `report` returns true when the error WAS a setting conflict (the
// caller then shows it inline and no alert); `recheck` asks the server again, so a message clears once the owner resolves it.
export function useSettingConflicts(partnerId) {
  const [entries, setEntries] = useState({});
  const ref = useRef(entries);
  ref.current = entries;

  const update = useCallback((fn) => {
    setEntries((prev) => {
      const next = fn(prev);
      ref.current = next;
      return next;
    });
  }, []);

  const report = useCallback((surface, error, meta = {}) => {
    const messages = settingConflictsOf(error);
    if (!messages) return false;
    update((prev) => reportConflict(prev, surface, messages, meta));
    return true;
  }, [update]);

  const clear = useCallback((surface) => update((prev) => clearConflict(prev, surface)), [update]);

  // Re-ask the server for every open surface (or one, with a fresh patch). A failed check leaves the message as it was.
  const recheck = useCallback(async (surface = null, check = null) => {
    if (!partnerId) return;
    const targets = surface ? [surface] : Object.keys(ref.current);
    await Promise.all(targets.map(async (s) => {
      const entry = ref.current[s];
      const c = check ?? entry?.check;
      if (!entry || !c) return;
      try {
        const messages = await checkBusinessSettingConflicts(partnerId, c.kind, c.patch);
        update((prev) => applyRecheck(prev, s, messages, c));
      } catch {
        // keep the message; the next save or check answers again
      }
    }));
  }, [partnerId, update]);

  return { entries, report, clear, recheck };
}
