// Visual preview harness (owner, 2026-11-28: before/after screenshots of the design-system work). NOT part of the app:
// scripts/design/preview/build.sh copies this file over App.web.js in a throwaway worktree, exports the web bundle, and
// capture.py screenshots each screen with every network call answered by fixtures (no backend is reached). It renders the
// REAL screens from src/screens, unmodified, one per URL hash (#Home, #Profile, ...). react-native-web, not iOS: fonts,
// shadows and safe areas differ from the phone; layout, sizes, colours, spacing and hierarchy are the same code.
import React from 'react';
import { Animated, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PostHogProvider } from 'posthog-react-native';
import { installReducedMotionPolicy } from './src/motion/motionPolicy';
import { installWebAlert } from './src/utils/webAlert';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { LanguageProvider } from './src/context/LanguageContext';

installReducedMotionPolicy(Animated);
installWebAlert(Alert);

const SCREENS = {
  Home: () => require('./src/screens/HomeScreen').default,
  Discover: () => require('./src/screens/DiscoverHubScreen').default,
  Create: () => require('./src/screens/CreateHubScreen').default,
  CreateGathering: () => require('./src/screens/CreateGatheringScreen').default,
  GatheringDetail: () => require('./src/screens/GatheringDetailScreen').default,
  Profile: () => require('./src/screens/ProfileScreen').default,
  FriendDiscovery: () => require('./src/screens/FriendDiscoveryScreen').default,
  Celebrate: () => require('./src/screens/CelebrateSomethingScreen').default,
  Login: () => require('./src/screens/LoginScreen').default,
  Activity: () => require('./src/screens/ActivityScreen').default,
  BusinessDashboard: () => require('./src/screens/BusinessDashboardScreen').default,
};
const PARAMS = { GatheringDetail: { gatheringId: '55555555-5555-4555-8555-555555555551' } };

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? React.createElement('div', { id: 'preview-error' }, 'PREVIEW ERROR: ' + String(this.state.err)) : this.props.children; }
}

const Stack = createNativeStackNavigator();
export default function PreviewApp() {
  const name = (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'Home';
  const Screen = (SCREENS[name] || SCREENS.Home)();
  return (
    <PostHogProvider apiKey="disabled" options={{ disabled: true }} autocapture={false}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <Boundary>
              <NavigationContainer>
                <Stack.Navigator>
                  <Stack.Screen name={name} component={Screen} initialParams={PARAMS[name]} options={{ headerShown: name === 'GatheringDetail' || name === 'FriendDiscovery' }} />
                </Stack.Navigator>
              </NavigationContainer>
            </Boundary>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </PostHogProvider>
  );
}
