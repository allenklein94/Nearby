import React, { useEffect, useState, useRef } from 'react';
import { View, Image, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { registerForPushNotifications, updateBadgeCount } from '../services/notifications';
import { startBackgroundPresenceReporting } from '../services/proximity';
import { initPurchases } from '../services/purchases';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/LoginScreen';
import CompleteProfileScreen from '../screens/CompleteProfileScreen';
import DiscoveryScreen from '../screens/DiscoveryScreen';
import NoticesScreen from '../screens/NoticesScreen';
import MatchesScreen from '../screens/MatchesScreen';
import GatheringsScreen from '../screens/GatheringsScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import PaywallScreen from '../screens/PaywallScreen';
import AdminReportsScreen from '../screens/AdminReportsScreen';
import ViewProfileScreen from '../screens/ViewProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import LegalScreen from '../screens/LegalScreen';
import CreateGatheringScreen from '../screens/CreateGatheringScreen';
import SharedPlaylistScreen from '../screens/SharedPlaylistScreen';
import TripPlanningScreen from '../screens/TripPlanningScreen';
import SharedDecisionsScreen from '../screens/SharedDecisionsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Exported so notification-tap handling (in notifications.js) can
// navigate from outside the component tree — notifications can arrive
// while the app is backgrounded or even fully closed, well before any
// screen component exists to call navigation on.
export const navigationRef = createNavigationContainerRef();

const TAB_ICONS = {
  Gatherings: { active: 'calendar', inactive: 'calendar-outline', label: 'Gatherings' },
  Nearby: { active: 'location', inactive: 'location-outline', label: 'Nearby, Crossed Paths' },
  Notices: { active: 'hand-left', inactive: 'hand-left-outline', label: 'Notices' },
  Matches: { active: 'heart', inactive: 'heart-outline', label: 'Matches' },
};

function ProfileTabIcon({ focused, size, colors, photoUrl }) {
  if (!photoUrl) {
    return <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={size} color={focused ? colors.primary : colors.textTertiary} />;
  }

  return (
    <View style={[
      profileIconStyles.wrap,
      { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 },
      focused && { borderWidth: 2, borderColor: colors.primary },
    ]}>
      <Image source={{ uri: photoUrl }} style={[profileIconStyles.image, { width: size, height: size, borderRadius: size / 2 }]} />
    </View>
  );
}

const profileIconStyles = StyleSheet.create({
  wrap: { justifyContent: 'center', alignItems: 'center' },
  image: {},
});

function BouncyTabButton({ children, onPress, accessibilityLabel, accessibilityState }) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePress(event) {
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.8, speed: 50, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1.15, speed: 20, bounciness: 12, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 20, bounciness: 8, useNativeDriver: true }),
    ]).start();
    onPress(event);
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={1}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      accessible={true}
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}

function MainTabs() {
  const { colors } = useTheme();
  const [myPhotoUrl, setMyPhotoUrl] = useState(null);

  useEffect(() => {
    loadMyPhoto();
  }, []);

  async function loadMyPhoto() {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return;

    const { data } = await supabase.from('profiles').select('photo_url').eq('id', userId).single();
    if (data?.photo_url) {
      const url = await getSignedPhotoUrl(data.photo_url);
      setMyPhotoUrl(url);
    }
  }

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarButton: (props) => (
          <BouncyTabButton
            {...props}
            accessibilityLabel={route.name === 'Profile' ? 'Your Profile' : TAB_ICONS[route.name]?.label}
          />
        ),
        tabBarIcon: ({ focused, size }) => {
          if (route.name === 'Profile') {
            return <ProfileTabIcon focused={focused} size={size} colors={colors} photoUrl={myPhotoUrl} />;
          }
          const iconSet = TAB_ICONS[route.name];
          const iconName = focused ? iconSet.active : iconSet.inactive;
          return <Ionicons name={iconName} size={size} color={focused ? colors.primary : colors.textTertiary} />;
        },
      })}
    >
      <Tab.Screen name="Gatherings" component={GatheringsScreen} />
      <Tab.Screen name="Nearby" component={DiscoveryScreen} />
      <Tab.Screen name="Notices" component={NoticesScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} listeners={{ focus: loadMyPhoto }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { session, loading, profileComplete, profileLoading } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    if (session && profileComplete) {
      initPurchases(session.user.id);
      registerForPushNotifications(session.user.id);
      startBackgroundPresenceReporting();
      updateBadgeCount(session.user.id);
    }
  }, [session, profileComplete]);

  if (loading || (session && profileLoading)) return null;

  return (
    <NavigationContainer ref={navigationRef}>
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
            <Stack.Screen name="Legal" component={LegalScreen} options={{ headerShown: true, title: 'Legal', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CreateGathering" component={CreateGatheringScreen} options={{ headerShown: true, title: 'Host a Gathering', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="SharedPlaylist" component={SharedPlaylistScreen} options={{ headerShown: true, title: 'Shared Playlist', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="TripPlanning" component={TripPlanningScreen} options={{ headerShown: true, title: 'Plan a Trip', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="SharedDecisions" component={SharedDecisionsScreen} options={{ headerShown: true, title: 'Big Picture', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}