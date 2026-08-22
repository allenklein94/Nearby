import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { PostHogProvider } from 'posthog-react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { LanguageProvider } from './src/context/LanguageContext';
import RootNavigator from './src/navigation/RootNavigator';
import { setupNotificationTapHandling } from './src/services/notifications';
import { STRIPE_PUBLISHABLE_KEY, isStripeConfigured } from './src/services/stripeConnect';

// StripeProvider requires a real, non-empty publishableKey to initialize —
// no live key exists yet (see CLAUDE.md's Stripe Connect section), so this
// only wraps the app once one is genuinely configured. Everything renders
// exactly as it does today when it isn't; the payment-collection UI
// itself separately checks isStripeConfigured() before ever attempting to
// use the SDK.
function MaybeStripeProvider({ children }) {
  if (!isStripeConfigured()) return children;
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} urlScheme="nearby">
      {children}
    </StripeProvider>
  );
}

Sentry.init({
  dsn: 'https://4abcadc6172e8798db6dbb4ac609a3f8@o4511759611461632.ingest.us.sentry.io/4511759617163264',
  enabled: !__DEV__,
  tracesSampleRate: 0.2,
});

function StatusBarWithTheme() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

function App() {
  useEffect(() => {
    const cleanup = setupNotificationTapHandling();
    return cleanup;
  }, []);

  return (
    <PostHogProvider
      apiKey="phc_kEv3UMR6bbSC9Er9aVRarCxjiBVvW8ye2Gae2msUpjem"
      options={{ host: 'https://us.i.posthog.com' }}
    >
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <MaybeStripeProvider>
              <StatusBarWithTheme />
              <RootNavigator />
            </MaybeStripeProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </PostHogProvider>
  );
}

export default Sentry.wrap(App);