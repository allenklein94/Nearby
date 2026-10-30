// Cloudflare Turnstile on iOS / Android: Cloudflare's own widget in a WebView (Turnstile has no native SDK). Invisible
// unless Cloudflare needs a tick ('interaction-only'); then it grows to the widget's height in place. Messages go to
// onMessage (utils/captcha.js parseWidgetMessage); reset() asks for a fresh token. Links inside the widget (privacy,
// help) open in the browser, never inside the app.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { parseWidgetMessage, turnstileHtml } from '../utils/captcha';

const SHOWN_HEIGHT = 70;

const TurnstileWidget = forwardRef(function TurnstileWidget({ config, dark, language, onEvent, accessibilityLabel }, ref) {
  const web = useRef(null);
  const [interactive, setInteractive] = useState(false);
  const [html] = useState(() => turnstileHtml({ siteKey: config.siteKey, dark, language }));
  useImperativeHandle(ref, () => ({
    reset() { web.current?.injectJavaScript('window.resetTurnstile && window.resetTurnstile(); true;'); },
  }), []);
  return (
    <View
      style={{ height: interactive ? SHOWN_HEIGHT : 1, opacity: interactive ? 1 : 0, alignSelf: 'stretch', marginBottom: interactive ? 12 : 0 }}
      accessible={false}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!interactive}
    >
      <WebView
        ref={web}
        source={{ html, baseUrl: `${config.host}/` }}
        originWhitelist={['https://*', 'about:*']}
        javaScriptEnabled
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
        accessibilityLabel={accessibilityLabel}
        onMessage={(e) => {
          const m = parseWidgetMessage(e.nativeEvent?.data);
          if (!m) return;
          if (m.type === 'interactive') setInteractive(true);
          if (m.type === 'interactive_done' || m.type === 'token') setInteractive(false);
          onEvent?.(m);
        }}
        onError={() => onEvent?.({ type: 'error', code: 'webview' })}
        onHttpError={() => onEvent?.({ type: 'error', code: 'http' })}
        onShouldStartLoadWithRequest={(req) => {
          if (req.isTopFrame === false) return true; // Cloudflare's challenge iframe
          if (req.url.startsWith(`${config.host}/`) || req.url.startsWith('about:')) return true;
          Linking.openURL(req.url).catch(() => {});
          return false;
        }}
      />
    </View>
  );
});

export default TurnstileWidget;
