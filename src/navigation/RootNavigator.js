import React, { useEffect, useState, useRef } from 'react';
import { View, Image, StyleSheet, Animated, TouchableOpacity, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { registerForPushNotifications, updateBadgeCount, consumePendingNotificationTap } from '../services/notifications';
import { startBackgroundPresenceReporting } from '../services/proximity';
import { initPurchases } from '../services/purchases';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getInboxUnreadCount } from '../services/homeDashboard';
import OnboardingScreen from '../screens/OnboardingScreen';
import OnboardingQuestionsScreen from '../screens/OnboardingQuestionsScreen';
import OnboardingLocationScreen from '../screens/OnboardingLocationScreen';
import OnboardingRecommendationsScreen from '../screens/OnboardingRecommendationsScreen';
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
import BusinessDashboardScreen from '../screens/BusinessDashboardScreen';
import BusinessPartnerApplyScreen from '../screens/BusinessPartnerApplyScreen';
import MyBusinessApplicationScreen from '../screens/MyBusinessApplicationScreen';
import RequestBusinessPartnerScreen from '../screens/RequestBusinessPartnerScreen';
import AdminBusinessRequestsScreen from '../screens/AdminBusinessRequestsScreen';
import BusinessConversationScreen from '../screens/BusinessConversationScreen';
import BusinessProfileScreen from '../screens/BusinessProfileScreen';
import EditGatheringScreen from '../screens/EditGatheringScreen';
import PlacesScreen from '../screens/PlacesScreen';
import TimelineScreen from '../screens/TimelineScreen';
import ActivityScreen from '../screens/ActivityScreen';
import GatheringsScreen from '../screens/GatheringsScreen';
import GatheringDetailScreen from '../screens/GatheringDetailScreen';
import GatheringHubScreen from '../screens/GatheringHubScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import PaywallScreen from '../screens/PaywallScreen';
import BillingScreen from '../screens/BillingScreen';
import AdminReportsScreen from '../screens/AdminReportsScreen';
import ViewProfileScreen from '../screens/ViewProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import LegalScreen from '../screens/LegalScreen';
import CreateGatheringScreen from '../screens/CreateGatheringScreen';
import GatheringConfirmationScreen from '../screens/GatheringConfirmationScreen';
import SharedPlaylistScreen from '../screens/SharedPlaylistScreen';
import TripPlanningScreen from '../screens/TripPlanningScreen';
import SharedDecisionsScreen from '../screens/SharedDecisionsScreen';
import RelationshipLegacyScreen from '../screens/RelationshipLegacyScreen';
import LegacyLibraryScreen from '../screens/LegacyLibraryScreen';
import GoodbyeArchiveEntryScreen from '../screens/GoodbyeArchiveEntryScreen';
import GoodbyeArchiveListScreen from '../screens/GoodbyeArchiveListScreen';
import RelationshipEmergencyKitScreen from '../screens/RelationshipEmergencyKitScreen';
import RelationshipToolsScreen from '../screens/RelationshipToolsScreen';
import RelationshipHubScreen from '../screens/RelationshipHubScreen';
import TimelinePlannerScreen from '../screens/TimelinePlannerScreen';
import MemoryVaultScreen from '../screens/MemoryVaultScreen';
import MemoryVaultIndexScreen from '../screens/MemoryVaultIndexScreen';
import InsightsScreen from '../screens/InsightsScreen';
import MomentumScreen from '../screens/MomentumScreen';
import PlansScreen from '../screens/PlansScreen';
import RewardsScreen from '../screens/RewardsScreen';
import AIConciergeScreen from '../screens/AIConciergeScreen';
import BusinessAIAssistantScreen from '../screens/BusinessAIAssistantScreen';
import EmergencyContactsScreen from '../screens/EmergencyContactsScreen';
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
import MusicModeScreen from '../screens/MusicModeScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

export const navigationRef = createNavigationContainerRef();

// Real deep linking, scoped to just the GatheringDetail path this pass
// (Create 2.0's "Share Gathering" action needs an actual working link,
// not a URL that silently does nothing when tapped — the same class of
// dead-feature bug this codebase has caught and fixed before, e.g. the
// dead gathering_invite push case). "nearby" is already the configured
// scheme in app.json. Not a general deep-linking overhaul — no other
// route is wired up here.
const linking = {
  prefixes: ['nearby://'],
  config: {
    screens: {
      GatheringDetail: 'gathering/:gatheringId',
    },
  },
};

// GatheringDetail (like every screen but Onboarding/Login/CompleteProfile)
// only exists in the Stack.Navigator tree once session && profileComplete
// are both true (see the conditional Stack.Screen block below) — so
// NavigationContainer's own `linking` resolution above has nothing to
// navigate to for a tapped nearby://gathering/:id link from someone not
// yet signed in, which is exactly the audience "Share Gathering"/"Share
// Link" actually targets (GatheringConfirmationScreen.js,
// GatheringHubScreen.js). Without this, that link would silently do
// nothing for a not-yet-authenticated recipient — the same class of
// dead-link bug this file has already caught and fixed once for this
// exact feature. Captured independently of NavigationContainer's own
// linking so it survives across the auth-state screen swap: stash the
// target gatheringId, then consume it once the authenticated stack is
// actually mounted (mirrors the existing just_completed_signup pattern
// below). Harmless if it also fires for an already-authenticated tap —
// navigating to a screen you're already on with the same params is a
// no-op, not a duplicate entry.
const PENDING_GATHERING_LINK_KEY = 'pending_deep_link_gathering_id';

function gatheringIdFromUrl(url) {
  const match = /gathering\/([^/?#]+)/.exec(url ?? '');
  return match ? match[1] : null;
}

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
      <Tab.Screen name="Profile" component={ProfileScreen} listeners={{ focus: loadMyPhoto }} options={{ tabBarLabel: 'You' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { session, loading, profileComplete, profileLoading } = useAuth();
  const { colors } = useTheme();

  // Runs once, independent of auth state, so a nearby://gathering/:id link
  // tapped before signing in (or mid-onboarding) isn't lost — see the
  // PENDING_GATHERING_LINK_KEY comment above the linking config.
  useEffect(() => {
    function stashIfGathering(url) {
      const gatheringId = gatheringIdFromUrl(url);
      if (gatheringId) AsyncStorage.setItem(PENDING_GATHERING_LINK_KEY, gatheringId);
    }
    Linking.getInitialURL().then(stashIfGathering);
    const subscription = Linking.addEventListener('url', ({ url }) => stashIfGathering(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (session && profileComplete) {
      AsyncStorage.getItem(PENDING_GATHERING_LINK_KEY).then((gatheringId) => {
        if (gatheringId) {
          AsyncStorage.removeItem(PENDING_GATHERING_LINK_KEY);
          setTimeout(() => {
            if (navigationRef.isReady()) {
              navigationRef.navigate('GatheringDetail', { gatheringId });
            }
          }, 300);
        }
      });
      initPurchases(session.user.id);
      registerForPushNotifications(session.user.id);
      startBackgroundPresenceReporting();
      updateBadgeCount(session.user.id);
      setTimeout(() => {
        consumePendingNotificationTap();
      }, 300);
      // Checked and cleared here so the recommendations screen only
      // ever shows once, right after a fresh signup — every
      // subsequent app open goes straight to MainTabs as normal.
      // Uses the imperative nav ref rather than initialRouteName,
      // since initialRouteName only applies on this navigator's
      // first mount and won't react to this state changing later.
      AsyncStorage.getItem('just_completed_signup').then((flag) => {
        if (flag === 'true') {
          AsyncStorage.removeItem('just_completed_signup');
          setTimeout(() => {
            if (navigationRef.isReady()) {
              navigationRef.navigate('OnboardingRecommendations');
            }
          }, 300);
        }
      });
    }
  }, [session, profileComplete]);
  if (loading || (session && profileLoading)) return null;

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="OnboardingQuestions" component={OnboardingQuestionsScreen} />
            <Stack.Screen name="OnboardingLocation" component={OnboardingLocationScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </>
        ) : !profileComplete ? (
          <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="OnboardingRecommendations" component={OnboardingRecommendationsScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Billing" component={BillingScreen} options={{ headerShown: true, title: 'Billing', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
            <Stack.Screen name="ViewProfile" component={ViewProfileScreen} options={{ headerShown: true, title: 'Profile', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true, title: 'Settings', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Legal" component={LegalScreen} options={{ headerShown: true, title: 'Legal', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CreateGathering" component={CreateGatheringScreen} options={{ headerShown: true, title: 'Host a Gathering', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="GatheringConfirmation" component={GatheringConfirmationScreen} options={{ headerShown: false, presentation: 'modal', gestureEnabled: false }} />
            <Stack.Screen name="SharedPlaylist" component={SharedPlaylistScreen} options={{ headerShown: true, title: 'Shared Playlist', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="TripPlanning" component={TripPlanningScreen} options={{ headerShown: true, title: 'Plan a Trip', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="SharedDecisions" component={SharedDecisionsScreen} options={{ headerShown: true, title: 'Big Picture', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipLegacy" component={RelationshipLegacyScreen} options={{ headerShown: true, title: 'Leave Wisdom', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="LegacyLibrary" component={LegacyLibraryScreen} options={{ headerShown: true, title: 'Relationship Wisdom', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GoodbyeArchiveEntry" component={GoodbyeArchiveEntryScreen} options={{ headerShown: true, title: 'Private Reflection', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="GoodbyeArchiveList" component={GoodbyeArchiveListScreen} options={{ headerShown: true, title: 'Private Reflections', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipEmergencyKit" component={RelationshipEmergencyKitScreen} options={{ headerShown: true, title: 'Emergency Kit', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipTools" component={RelationshipToolsScreen} options={{ headerShown: true, title: 'Relationship Tools', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipHub" component={RelationshipHubScreen} options={{ headerShown: true, title: 'Relationship', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="TimelinePlanner" component={TimelinePlannerScreen} options={{ headerShown: true, title: 'Timeline', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MemoryVault" component={MemoryVaultScreen} options={{ headerShown: true, title: 'Memory Vault', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MemoryVaultIndex" component={MemoryVaultIndexScreen} options={{ headerShown: true, title: 'Memory Vaults', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Insights" component={InsightsScreen} options={{ headerShown: true, title: 'Your Insights', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Momentum" component={MomentumScreen} options={{ headerShown: true, title: 'Your Momentum', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Plans" component={PlansScreen} options={{ headerShown: true, title: 'Your Plans', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Rewards" component={RewardsScreen} options={{ headerShown: true, title: 'Your Rewards', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AIConcierge" component={AIConciergeScreen} options={{ headerShown: true, title: 'AI Concierge', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessAIAssistant" component={BusinessAIAssistantScreen} options={{ headerShown: true, title: 'AI Assistant', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} options={{ headerShown: true, title: 'Emergency Contacts', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MusicMode" component={MusicModeScreen} options={{ headerShown: true, title: 'Music Mode', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
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
            <Stack.Screen name="GatheringDetail" component={GatheringDetailScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GatheringHub" component={GatheringHubScreen} options={{ headerShown: true, title: '', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Notices" component={ActivityScreen} options={{ headerShown: true, title: 'Activity', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Friends" component={FriendsScreen} options={{ headerShown: true, title: 'Friends', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GatheringChat" component={GatheringChatScreen} options={({ route }) => ({ headerShown: true, title: route.params?.gatheringTitle ? `${route.params.gatheringTitle} Chat` : 'Group Chat', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false })} />
            <Stack.Screen name="QuickFilterCustomize" component={QuickFilterCustomizeScreen} options={{ headerShown: true, title: 'Customize Quick Filters', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Communities" component={CommunitiesScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} options={{ headerShown: true, title: 'Create Community', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="CommunityDetail" component={CommunityDetailScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CommunityChat" component={CommunityChatScreen} options={({ route }) => ({ headerShown: true, title: route.params?.communityName ? `${route.params.communityName} Chat` : 'Community Chat', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false })} />
            <Stack.Screen name="BusinessDashboard" component={BusinessDashboardScreen} options={{ headerShown: true, title: 'Business Dashboard', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessPartnerApply" component={BusinessPartnerApplyScreen} options={{ headerShown: true, title: 'Partner With Us', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MyBusinessApplication" component={MyBusinessApplicationScreen} options={{ headerShown: true, title: 'My Application', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RequestBusinessPartner" component={RequestBusinessPartnerScreen} options={{ headerShown: true, title: 'Request a Business Partner', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminBusinessRequests" component={AdminBusinessRequestsScreen} options={{ headerShown: true, title: 'Business Requests (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessConversation" component={BusinessConversationScreen} options={({ route }) => ({ headerShown: true, title: route.params?.partnerName ?? 'Message', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false })} />
            <Stack.Screen name="BusinessProfile" component={BusinessProfileScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="EditGathering" component={EditGatheringScreen} options={{ headerShown: true, title: 'Edit Gathering', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="Places" component={PlacesScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Timeline" component={TimelineScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}