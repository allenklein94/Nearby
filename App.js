import React from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';

Sentry.init({
  dsn: 'https://4abcadc6172e8798db6dbb4ac609a3f8@o4511759611461632.ingest.us.sentry.io/4511759617163264',
  enabled: !__DEV__,
  tracesSampleRate: 0.2,
});

function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}

export default Sentry.wrap(App);