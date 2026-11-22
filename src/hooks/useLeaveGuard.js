// One way for a stack screen to ask before it is left with unsaved work (Tier 1 fix, build 87, 2026-11-22).
//
// Why not a raw beforeRemove listener + preventDefault: under native-stack the iOS header back button and the
// back swipe pop the screen NATIVELY first; preventing the JS pop afterwards leaves the native and JS stacks out of step
// (native-stack logs "removed natively but didn't get removed from JS state"), the screen comes back and the confirm
// dialog, opened mid-transition, never appears: Back looks dead. usePreventRemove tells iOS to cancel the native pop
// (preventNativeDismiss) while `active`, so the press reaches JS and the dialog shows. Android's back button and header
// arrow already go through JS and behave the same. The screen's options must set headerBackButtonMenuEnabled: false (the
// long-press back menu can't be prevented; guard `navigation/leaveGuard.test.js`).
//
// active: whether leaving now would lose something (computed at render).
// allowLeaveRef: set true by the screen right before it leaves on purpose (after a save), so that leave never asks.
// confirm({ onKeepEditing, onDiscard }): shows the question; Discard continues the original navigation.
import { UNSTABLE_usePreventRemove as usePreventRemove, useNavigation } from '@react-navigation/native';
import { leaveGuardResponse } from '../utils/leaveGuard';

export default function useLeaveGuard({ active, allowLeaveRef, confirm }) {
  const navigation = useNavigation();
  usePreventRemove(!!active, ({ data }) => {
    leaveGuardResponse({
      allowLeave: !!allowLeaveRef?.current,
      action: data?.action,
      confirm,
      proceed: (action) => {
        if (allowLeaveRef) allowLeaveRef.current = true;
        // data.action carries the routes already asked, so dispatching it again never asks twice.
        if (action) navigation.dispatch(action);
        else navigation.goBack();
      },
    });
  });
}
