// react-native-web ships Alert.alert as a no-op, so on the business website every confirmation ("Cancel this
// reservation?"), validation message and error the shared screens raise silently vanished -- a confirm-gated action
// simply never ran. This is the browser adapter for the same call, installed once by App.web.js; the native app is
// untouched and every screen keeps calling Alert.alert unchanged.
//
// Mapping: no buttons / one button -> window.alert, then that button's onPress. Two or more -> window.confirm, where
// OK runs the action (the destructive one if several, else the first non-cancel) and Cancel runs the cancel button's
// onPress. That covers every dialog these screens use (a message, or a cancel plus one action).
export function showWebAlert(title, message, buttons, env = typeof window !== 'undefined' ? window : null) {
  if (!env) return;
  const body = [title, message].filter(Boolean).join('\n\n');
  const list = Array.isArray(buttons) ? buttons : [];
  if (list.length <= 1) {
    env.alert(body);
    list[0]?.onPress?.();
    return;
  }
  const cancel = list.find((b) => b.style === 'cancel');
  const actions = list.filter((b) => b !== cancel);
  const action = actions.find((b) => b.style === 'destructive') ?? actions[0];
  if (env.confirm(body)) action?.onPress?.();
  else cancel?.onPress?.();
}

export function installWebAlert(Alert) {
  Alert.alert = (title, message, buttons) => showWebAlert(title, message, buttons);
}
