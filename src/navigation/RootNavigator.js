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
import { getInboxUnreadCount } from '../services/homeDashboard';
import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/LoginScreen';
import CompleteProfileScreen from '../screens/CompleteProfileScreen';
import DiscoveryScreen from '../screens/DiscoveryScreen';
import HomeScreen from '../screens/HomeScreen';
import DiscoverHubScreen from '../screens/DiscoverHubScreen';
import CreateHubScreen from '../screens/CreateHubScreen';
import InboxScreen from '../screens/InboxScreen';
import CommunitiesScreen from '../screens/CommunitiesScreen';
import CreateCommunityScreen from '../screens/CreateCommunityScreen';
import CommunityDetailScreen from '../screens/CommunityDetailScreen';
import CommunityChatScreen from '../screens/CommunityChatScreen';
import ActivityScreen from '../screens/ActivityScreen';
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
import RelationshipLegacyScreen from '../screens/RelationshipLegacyScreen';
import LegacyLibraryScreen from '../screens/LegacyLibraryScreen';
import GoodbyeArchiveEntryScreen from '../screens/GoodbyeArchiveEntryScreen';
import GoodbyeArchiveListScreen from '../screens/GoodbyeArchiveListScreen';
import RelationshipEmergencyKitScreen from '../screens/RelationshipEmergencyKitScreen';
import TimelinePlannerScreen from '../screens/TimelinePlannerScreen';
import MemoryVaultScreen from '../screens/MemoryVaultScreen';
import ChemistryDiaryEntryScreen from '../screens/ChemistryDiaryEntryScreen';
import ChemistryDiaryListScreen from '../screens/ChemistryDiaryListScreen';
import StressTestScreen from '../screens/StressTestScreen';
import RelationshipConstitutionScreen from '../screens/RelationshipConstitutionScreen';
import BrandOffersScreen from '../screens/BrandOffersScreen';
import RehearsalRoomScreen from '../screens/RehearsalRoomScreen';
import IdVerificationScreen from '../screens/IdVerificationScreen';
import AdminVerificationScreen from '../screens/AdminVerificationScreen';
import InviteFriendsScreen from '../screens/InviteFriendsScreen';
import BlockedUsersScreen from '../screens/BlockedUsersScreen';
import FeaturesOverviewScreen from '../screens/FeaturesOverviewScreen';
import SelectGatheringLocationScreen from '../screens/SelectGatheringLocationScreen';
import FriendsScreen from '../screens/FriendsScreen';
import GatheringChatScreen from '../screens/GatheringChatScreen';
import QuickFilterCustomizeScreen from '../screens/QuickFilterCustomizeScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export const navigationRef = createNavigationContainerRef();

const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Discover: { active: 'compass', inactive: 'compass-outline', label: 'Discover' },
  Create: { active: 'add-circle', inactive: 'add-circle-outline', label: 'Create' },
  Matches: { active: 'chatbubbles', inactive: 'chatbubbles-outline', label: 'Inbox' },
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
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);

  useEffect(() => {
    loadMyPhoto();
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadUnreadCount() {
    const count = await getInboxUnreadCount();
    setInboxUnreadCount(count);
  }

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
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Discover" component={DiscoverHubScreen} />
      <Tab.Screen name="Create" component={CreateHubScreen} />
      <Tab.Screen name="Matches" component={InboxScreen} options={{ tabBarLabel: 'Inbox', tabBarBadge: inboxUnreadCount > 0 ? inboxUnreadCount : undefined }} />
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
            <Stack.Screen name="RelationshipLegacy" component={RelationshipLegacyScreen} options={{ headerShown: true, title: 'Leave Wisdom', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="LegacyLibrary" component={LegacyLibraryScreen} options={{ headerShown: true, title: 'Relationship Wisdom', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GoodbyeArchiveEntry" component={GoodbyeArchiveEntryScreen} options={{ headerShown: true, title: 'Private Reflection', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="GoodbyeArchiveList" component={GoodbyeArchiveListScreen} options={{ headerShown: true, title: 'Private Reflections', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipEmergencyKit" component={RelationshipEmergencyKitScreen} options={{ headerShown: true, title: 'Emergency Kit', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="TimelinePlanner" component={TimelinePlannerScreen} options={{ headerShown: true, title: 'Timeline', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MemoryVault" component={MemoryVaultScreen} options={{ headerShown: true, title: 'Memory Vault', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="ChemistryDiaryEntry" component={ChemistryDiaryEntryScreen} options={{ headerShown: true, title: 'Chemistry Check-In', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="ChemistryDiaryList" component={ChemistryDiaryListScreen} options={{ headerShown: true, title: 'Chemistry Diary', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="StressTest" component={StressTestScreen} options={{ headerShown: true, title: 'What If...', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipConstitution" component={RelationshipConstitutionScreen} options={{ headerShown: true, title: 'Our Constitution', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BrandOffers" component={BrandOffersScreen} options={{ headerShown: true, title: 'Offers & Perks', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RehearsalRoom" component={RehearsalRoomScreen} options={{ headerShown: true, title: 'Rehearsal Room', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="IdVerification" component={IdVerificationScreen} options={{ headerShown: true, title: 'Verify Identity', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminVerification" component={AdminVerificationScreen} options={{ headerShown: true, title: 'Verifications (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="InviteFriends" component={InviteFriendsScreen} options={{ headerShown: true, title: 'Invite Friends', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ headerShown: true, title: 'Blocked Users', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="FeaturesOverview" component={FeaturesOverviewScreen} options={{ headerShown: true, title: 'Everything In Nearby', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="SelectGatheringLocation" component={SelectGatheringLocationScreen} options={{ headerShown: true, title: 'Set Location', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Nearby" component={DiscoveryScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Gatherings" component={GatheringsScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Notices" component={ActivityScreen} options={{ headerShown: true, title: 'Activity', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Friends" component={FriendsScreen} options={{ headerShown: true, title: 'Friends', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GatheringChat" component={GatheringChatScreen} options={({ route }) => ({ headerShown: true, title: route.params?.gatheringTitle ?? 'Group Chat', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false })} />
            <Stack.Screen name="QuickFilterCustomize" component={QuickFilterCustomizeScreen} options={{ headerShown: true, title: 'Customize Quick Filters', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Communities" component={CommunitiesScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} options={{ headerShown: true, title: 'Create Community', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="CommunityDetail" component={CommunityDetailScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CommunityChat" component={CommunityChatScreen} options={({ route }) => ({ headerShown: true, title: route.params?.communityName ?? 'Community Chat', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false })} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}