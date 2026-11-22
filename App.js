import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { PostHogProvider } from 'posthog-react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { Animated } from 'react-native';
import { installReducedMotionPolicy } from './src/motion/motionPolicy';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { LanguageProvider } from './src/context/LanguageContext';
import RootNavigator from './src/navigation/RootNavigator';
import { SuccessToastHost } from './src/motion';
import OfferArrivalHost from './src/components/OfferArrivalSignal';
import OfferTravelOverlay from './src/motion/OfferTravelOverlay';
import { setupNotificationTapHandling } from './src/services/notifications';
import { ENVIRONMENT_ERROR, SERVICES } from './src/services/supabase';
import ConfigErrorScreen from './src/components/ConfigErrorScreen';
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

// Item 127: enforce OS Reduce Motion for every Animated.spring/loop app-wide, once, at startup.
installReducedMotionPolicy(Animated);

Sentry.init({
  dsn: 'https://4abcadc6172e8798db6dbb4ac609a3f8@o4511759611461632.ingest.us.sentry.io/4511759617163264',
  // Crash reports only from production (src/config/environments.js serviceSwitches): staging never mixes into them.
  enabled: !__DEV__ && SERVICES.crashReporting,
  tracesSampleRate: 0.2,
});

function StatusBarWithTheme() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

function App() {
  // A missing or mixed environment = nothing else renders (no request, no notification handling).
  if (ENVIRONMENT_ERROR) return <ConfigErrorScreen message={ENVIRONMENT_ERROR} />;
  return <ConfiguredApp />;
}

function ConfiguredApp() {
  useEffect(() => {
    const cleanup = setupNotificationTapHandling();
    return cleanup;
  }, []);

  // Analytics only from production; elsewhere a disabled client keeps usePostHog() callers working and sends nothing.
  const posthog = SERVICES.analytics
    ? { apiKey: 'phc_kEv3UMR6bbSC9Er9aVRarCxjiBVvW8ye2Gae2msUpjem', options: { host: 'https://us.i.posthog.com' } }
    : { apiKey: 'disabled', options: { disabled: true } };

  return (
    <PostHogProvider apiKey={posthog.apiKey} options={posthog.options}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <MaybeStripeProvider>
              <StatusBarWithTheme />
              <RootNavigator />
              <SuccessToastHost />
              <OfferTravelOverlay />
              <OfferArrivalHost />
            </MaybeStripeProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </PostHogProvider>
  );
}

export default Sentry.wrap(App);