// Cloudflare Turnstile on the business website (react-native-web): Cloudflare's script rendered straight into the page,
// same events and reset() as the native widget (components/TurnstileWidget.js).
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;
function loadTurnstile() {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC; s.async = true; s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
      s.onerror = () => { loading = null; reject(new Error('script')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const TurnstileWidget = forwardRef(function TurnstileWidget({ config, dark, language, onEvent, accessibilityLabel }, ref) {
  const box = useRef(null);
  const wid = useRef(null);
  const emit = useRef(onEvent);
  emit.current = onEvent;
  useImperativeHandle(ref, () => ({ reset() { if (window.turnstile && wid.current != null) window.turnstile.reset(wid.current); } }), []);
  useEffect(() => {
    let gone = false;
    loadTurnstile().then((ts) => {
      if (gone || !box.current) return;
      wid.current = ts.render(box.current, {
        sitekey: config.siteKey, theme: dark ? 'dark' : 'light', language, action: 'login',
        size: 'flexible', appearance: 'interaction-only', 'refresh-expired': 'auto',
        callback: (t) => emit.current?.({ type: 'token', token: t }),
        'error-callback': (c) => { emit.current?.({ type: 'error', code: String(c) }); return true; },
        'expired-callback': () => emit.current?.({ type: 'expired' }),
        'unsupported-callback': () => emit.current?.({ type: 'error', code: 'unsupported' }),
        'timeout-callback': () => emit.current?.({ type: 'error', code: 'challenge_timeout' }),
        'before-interactive-callback': () => emit.current?.({ type: 'interactive' }),
        'after-interactive-callback': () => emit.current?.({ type: 'interactive_done' }),
      });
    }, () => emit.current?.({ type: 'error', code: 'script' }));
    return () => { gone = true; if (window.turnstile && wid.current != null) window.turnstile.remove(wid.current); wid.current = null; };
  }, [config.siteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View ref={box} accessibilityLabel={accessibilityLabel} style={{ alignSelf: 'stretch', alignItems: 'center' }} />;
});

export default TurnstileWidget;
