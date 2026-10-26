import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { setGatheringInterested, getInterestedDemandPrefs, acknowledgeInterestedDisclosure } from '../services/gatherings';
import { interestedSetWith, overridesAfterRefresh, firstInterestedDisclosureKey } from '../utils/cardInterested';
import { interestedConfirmation } from '../utils/actionConfirmations';
import { presentRecoverableError } from '../utils/recoverableError';
import { showSuccessToast } from '../motion';
import { tr } from '../i18n/translate';

// Interested toggled from a card, without leaving the surface (Home's low-commitment rows, Discover's ☆; rules in
// utils/cardInterested.js). `interestedIds`: the surface's own read of the person's Interested ids (null = unknown), refreshed on
// focus, so a change made on GatheringDetail or another surface shows on return. Optimistic: the control flips at the tap; "✓"
// (item 30) plays only once the save returned; the toast keeps its Undo (item 124); a failed save flips back and offers Try Again.
// The first-ever Interested explains the optional sharing in place (idea "356"), never by sending the person to another screen.
export default function useCardInterested({ interestedIds, navigation }) {
  const [override, setOverride] = useState({});
  const [flash, setFlash] = useState({});
  const busyRef = useRef(new Set()); // one save per card at a time; a second tap while it runs is ignored

  useEffect(() => {
    setOverride((o) => overridesAfterRefresh(o, busyRef.current));
  }, [interestedIds]);

  const interestedSet = useMemo(() => interestedSetWith(interestedIds, override), [interestedIds, override]);

  function explainSharingOnce() {
    getInterestedDemandPrefs().catch(() => null).then((prefs) => {
      const key = firstInterestedDisclosureKey(prefs);
      if (!key) return;
      Alert.alert(tr('ui.actions.savedInterested'), tr(key), [
        { text: tr('ui.common.gotIt'), onPress: () => { acknowledgeInterestedDisclosure(); } },
        { text: tr('ui.gatheringDetail.changeInSettings'), onPress: () => { acknowledgeInterestedDisclosure(); navigation.navigate('Settings'); } },
      ]);
    });
  }

  async function toggle(g, on) {
    if (busyRef.current.has(g.id)) return;
    busyRef.current.add(g.id);
    setOverride((o) => ({ ...o, [g.id]: !on }));
    if (on) setFlash((f) => ({ ...f, [g.id]: 0 }));
    try {
      await setGatheringInterested(g.id, !on);
      if (!on) setFlash((f) => ({ ...f, [g.id]: (f[g.id] ?? 0) + 1 }));
      showSuccessToast(...interestedConfirmation(!on), { undo: () => undo(g, on) });
      if (!on) explainSharingOnce();
    } catch (e) {
      setOverride((o) => ({ ...o, [g.id]: on }));
      setFlash((f) => ({ ...f, [g.id]: 0 }));
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => toggle(g, on) });
    } finally {
      busyRef.current.delete(g.id);
    }
  }

  async function undo(g, previous) {
    setOverride((o) => ({ ...o, [g.id]: previous }));
    if (!previous) setFlash((f) => ({ ...f, [g.id]: 0 }));
    try {
      await setGatheringInterested(g.id, previous);
    } catch (e) {
      setOverride((o) => ({ ...o, [g.id]: !previous }));
      presentRecoverableError(Alert, { what: 'undo that', error: e, onRetry: () => undo(g, previous) });
    }
  }

  return { interestedSet, flashKey: (id) => flash[id], toggle };
}
