// One Turnstile token per auth request (utils/captcha.js). `enabled` = a site key is configured; when it isn't, take()
// resolves with no token and nothing is drawn (today's behaviour). After every use the widget is reset for a fresh token.
import { useCallback, useMemo, useRef } from 'react';
import { TURNSTILE } from '../services/captcha';
import { createCaptchaTokenStore } from '../utils/captcha';

export default function useAuthCaptcha(config = TURNSTILE) {
  const widget = useRef(null);
  const store = useMemo(() => createCaptchaTokenStore(), []);
  const onEvent = useCallback((m) => {
    if (m.type === 'token') store.onToken(m.token);
    else if (m.type === 'error') store.onError(m.code);
    else if (m.type === 'expired') store.onExpired();
    else if (m.type === 'interactive') store.onInteractive();
    else if (m.type === 'interactive_done') store.onInteractiveDone();
  }, [store]);
  const take = useCallback(() => (config ? store.take() : Promise.resolve(null)), [config, store]);
  const reset = useCallback(() => { store.clear(); widget.current?.reset(); }, [store]);
  return { enabled: Boolean(config), config, widget, onEvent, take, reset };
}
