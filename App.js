import React from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { PostHogProvider } from 'posthog-react-native';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';

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
  return (
    <PostHogProvider
      apiKey="phc_kEv3UMR6bbSC9Er9aVRarCxjiBVvW8ye2Gae2msUpjem"
      options={{ host: 'https://us.i.posthog.com' }}
    >
      <ThemeProvider>
        <AuthProvider>
          <StatusBarWithTheme />
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </PostHogProvider>
  );
}

export default Sentry.wrap(App);