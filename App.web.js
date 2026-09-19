import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, Alert } from 'react-native';
import { installReducedMotionPolicy } from './src/motion/motionPolicy';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { LanguageProvider } from './src/context/LanguageContext';
import { installWebAlert } from './src/utils/webAlert';
import BusinessWebNavigator from './src/navigation/BusinessWebNavigator';

// Item 127: enforce OS Reduce Motion for every Animated.spring/loop, once, at startup.
installReducedMotionPolicy(Animated);
// react-native-web's Alert.alert is a no-op; without this every confirmation/error on the website silently vanished.
installWebAlert(Alert);

// Phase 7 (Business Web, CLAUDE.md) -- Metro resolves this file in place of
// App.js for web builds automatically (standard .web.js platform-extension
// convention, no config needed). Deliberately a smaller root than the
// native app's: Sentry/PostHog/Stripe/push-notification-tap-handling are
// app-wide instrumentation and payment scaffolding, not business logic, so
// omitting them here isn't duplicating or altering any business logic --
// AuthProvider/ThemeProvider/LanguageProvider (pure JS/AsyncStorage, no
// native deps) and every screen underneath are reused verbatim.
function StatusBarWithTheme() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <StatusBarWithTheme />
          <BusinessWebNavigator />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
