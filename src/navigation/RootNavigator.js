import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAuth } from '../context/AuthContext';
import { registerForPushNotifications } from '../services/notifications';
import { startBackgroundPresenceReporting } from '../services/proximity';
import { initPurchases } from '../services/purchases';
import { colors } from '../theme';
import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/LoginScreen';
import CompleteProfileScreen from '../screens/CompleteProfileScreen';
import DiscoveryScreen from '../screens/DiscoveryScreen';
import NoticesScreen from '../screens/NoticesScreen';
import MatchesScreen from '../screens/MatchesScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import PaywallScreen from '../screens/PaywallScreen';
import AdminReportsScreen from '../screens/AdminReportsScreen';
import ViewProfileScreen from '../screens/ViewProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Nearby" component={DiscoveryScreen} />
      <Tab.Screen name="Notices" component={NoticesScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { session, loading, profileComplete, profileLoading } = useAuth();

  useEffect(() => {
    if (session && profileComplete) {
      initPurchases(session.user.id);
      registerForPushNotifications(session.user.id);
      startBackgroundPresenceReporting();
    }
  }, [session, profileComplete]);

  if (loading || (session && profileLoading)) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </>
        ) : !profileComplete ? (
          <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
            <Stack.Screen name="ViewProfile" component={ViewProfileScreen} options={{ headerShown: true, title: 'Profile', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true, title: 'Settings', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}