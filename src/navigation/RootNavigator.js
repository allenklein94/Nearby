import React, { useEffect, useState, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Animated, TouchableOpacity, Text, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import TogetherNotesScreen from '../screens/TogetherNotesScreen';
import { TOGETHER_NOTES_KINDS } from '../constants/togetherNotesKinds';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { openOnTop, linkActionFromState } from './openOnTop';
import { canOpenFromOutside, keepEntry, takeEntry, whenOpenable, parseNearbyUrl } from './outsideEntry';
import { noteNavigationState, clearTrail } from './returnTrail';
import { registerForPushNotifications, updateBadgeCount, consumePendingNotificationTap } from '../services/notifications';
import { startBackgroundPresenceReporting } from '../services/proximity';
import { initPurchases } from '../services/purchases';
import { getActivityBadgeCount } from '../services/homeDashboard';
import { getMyManagedPartner } from '../services/brandOffers';
import { NLoader } from '../motion';
import useReduceMotion from '../hooks/useReduceMotion';
import OnboardingScreen from '../screens/OnboardingScreen';
import OnboardingQuestionsScreen from '../screens/OnboardingQuestionsScreen';
import OnboardingLocationScreen from '../screens/OnboardingLocationScreen';
import OnboardingNotificationsScreen from '../screens/OnboardingNotificationsScreen';
import OnboardingRecommendationsScreen from '../screens/OnboardingRecommendationsScreen';
import OnboardingOccasionsScreen from '../screens/OnboardingOccasionsScreen';
import LoginScreen from '../screens/LoginScreen';
import CompleteProfileScreen from '../screens/CompleteProfileScreen';
import HomeScreen from '../screens/HomeScreen';
import DiscoverHubScreen from '../screens/DiscoverHubScreen';
import FriendDiscoveryScreen from '../screens/FriendDiscoveryScreen';
import CreateHubScreen from '../screens/CreateHubScreen';
import CelebrateSomethingScreen from '../screens/CelebrateSomethingScreen';
import MessagesScreen from '../screens/MessagesScreen';
import CreateCommunityScreen from '../screens/CreateCommunityScreen';
import EditCommunityScreen from '../screens/EditCommunityScreen';
import CommunityDetailScreen from '../screens/CommunityDetailScreen';
import CommunityChatScreen from '../screens/CommunityChatScreen';
import BusinessDashboardScreen from '../screens/BusinessDashboardScreen';
import BusinessPartnerApplyScreen from '../screens/BusinessPartnerApplyScreen';
import MyBusinessApplicationScreen from '../screens/MyBusinessApplicationScreen';
import RequestBusinessPartnerScreen from '../screens/RequestBusinessPartnerScreen';
import AskBusinessScreen from '../screens/AskBusinessScreen';
import BusinessRequestDetailScreen from '../screens/BusinessRequestDetailScreen';
import GroupPlanScreen from '../screens/GroupPlanScreen';
import GroupOccasionPlanScreen from '../screens/GroupOccasionPlanScreen';
import DateProposalScreen from '../screens/DateProposalScreen';
import AdminSponsoredRefundsScreen from '../screens/AdminSponsoredRefundsScreen';
import AdminBusinessRequestsScreen from '../screens/AdminBusinessRequestsScreen';
import AdminBusinessTierScreen from '../screens/AdminBusinessTierScreen';
import AdminContentReviewScreen from '../screens/AdminContentReviewScreen';
import BusinessConversationScreen from '../screens/BusinessConversationScreen';
import BusinessProfileScreen from '../screens/BusinessProfileScreen';
import EditGatheringScreen from '../screens/EditGatheringScreen';
import ActivityScreen from '../screens/ActivityScreen';
import GatheringDetailScreen from '../screens/GatheringDetailScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import PaywallScreen from '../screens/PaywallScreen';
import BillingScreen from '../screens/BillingScreen';
import DatingPreferencesScreen from '../screens/DatingPreferencesScreen';
import AdminReportsScreen from '../screens/AdminReportsScreen';
import ViewProfileScreen from '../screens/ViewProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import LegalScreen from '../screens/LegalScreen';
import CreateGatheringScreen from '../screens/CreateGatheringScreen';
import SharedPlaylistScreen from '../screens/SharedPlaylistScreen';
import RelationshipLegacyScreen from '../screens/RelationshipLegacyScreen';
import LegacyLibraryScreen from '../screens/LegacyLibraryScreen';
import GoodbyeArchiveListScreen from '../screens/GoodbyeArchiveListScreen';
import RelationshipEmergencyKitScreen from '../screens/RelationshipEmergencyKitScreen';
import MemoryVaultScreen from '../screens/MemoryVaultScreen';
import MomentumScreen from '../screens/MomentumScreen';
import PlansScreen from '../screens/PlansScreen';
import MarketValidationScreen from '../screens/MarketValidationScreen';
import BusinessAIAssistantScreen from '../screens/BusinessAIAssistantScreen';
import EmergencyContactsScreen from '../screens/EmergencyContactsScreen';
import OccasionsScreen from '../screens/OccasionsScreen';
import PlanDetailScreen from '../screens/PlanDetailScreen';
import SharedNightScreen from '../screens/SharedNightScreen';
import ChemistryDiaryListScreen from '../screens/ChemistryDiaryListScreen';
import RehearsalRoomScreen from '../screens/RehearsalRoomScreen';
import IdVerificationScreen from '../screens/IdVerificationScreen';
import AdminVerificationScreen from '../screens/AdminVerificationScreen';
import InviteFriendsScreen from '../screens/InviteFriendsScreen';
import SelectGatheringLocationScreen from '../screens/SelectGatheringLocationScreen';
import FriendsScreen from '../screens/FriendsScreen';
import GatheringChatScreen from '../screens/GatheringChatScreen';
import PlanChatScreen from '../screens/PlanChatScreen';
import PreferencePollScreen from '../screens/PreferencePollScreen';
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
// Business Partner acquisition experience, Milestone 3 (see CLAUDE.md): a shareable
// nearby://business/:partnerId link (and a matching QR code on the dashboard) needs
// the identical "works for someone not yet signed in" treatment the gathering link
// above already got, but NOT a linking.config.screens entry of its own — unlike a
// gathering link, which always resolves to the same one screen regardless of who
// opens it, a business link's real destination genuinely branches (the business's
// own owner should land on their own dashboard, not a stranger's-eye-view of their
// own profile) and NavigationContainer's declarative path-to-route config can't
// express that branch. So the business link is handled entirely by the same
// stash-then-imperatively-navigate mechanism as the gathering link below, just with
// its own real ownership check before deciding where to send the tap — never wired
// into `linking.config.screens` at all.
// Business Partner acquisition experience, Milestone 5 (see CLAUDE.md): the new web landing
// page's primary CTA needs a real deep link into the mobile app's Milestone 2 apply flow, not a
// second, web-only reimplementation of it (Decision 1's own locked "claim/apply logic lives in
// exactly one place" rule). Unlike the business-profile link above, BusinessPartnerApply always
// resolves to the exact same screen regardless of who opens it — no ownership branch needed —
// so this one genuinely fits linking.config.screens directly, same shape as GatheringDetail.
const linking = {
  prefixes: ['nearby://'],
  config: {
    // Item 139: a cold-start link opens its screen with Home underneath, so Back lands on Home instead of leaving the app.
    initialRouteName: 'MainTabs',
    screens: {
      GatheringDetail: 'gathering/:gatheringId',
      BusinessPartnerApply: 'business-apply',
    },
  },
  // Item 139: a warm link opens on top of where the person was (openOnTop.js).
  getActionFromState: (state, options) => linkActionFromState(navigationRef)(state, options),
};

// GatheringDetail (like every screen but Onboarding/Login/CompleteProfile)
// only exists in the Stack.Navigator tree once session && profileComplete
// are both true (see the conditional Stack.Screen block below) — so
// NavigationContainer's own `linking` resolution above has nothing to
// navigate to for a tapped nearby://gathering/:id link from someone not
// yet signed in, which is exactly the audience "Share Gathering"/"Share
// Link" actually targets (GatheringPublishedPanel.js, and the
// attending section on GatheringDetailScreen.js). Without this, that link would silently do
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
const PENDING_BUSINESS_LINK_KEY = 'pending_deep_link_business_id';
const PENDING_BUSINESS_APPLY_LINK_KEY = 'pending_deep_link_business_apply';

async function resolveAndNavigateToBusiness(partnerId) {
  if (!canOpenFromOutside(navigationRef)) return;
  const myPartner = await getMyManagedPartner();
  if (myPartner?.id === partnerId) {
    openOnTop(navigationRef, 'BusinessDashboard');
  } else {
    openOnTop(navigationRef, 'BusinessProfile', { partnerId });
  }
}

// Aug 24 2026 (CLAUDE.md): the current 4-tab model -- Home / Discover /
// Create / Activity. Discover was a Phase 5 casualty (pushed screen only,
// reachable via a single buried hyperlink) despite being a core
// exploration surface -- it's a real tab again, with People folded in as
// a mode inside it (Things to Do / People) rather than People keeping its
// own tab for comparatively little content. Profile is the fifth tab again
// (owner, 2026-10-04): Home / Discover / Create / Activity / Profile, one job
// each; only Messages stays a header icon. Editing your profile is its own
// stack screen, EditProfile (item 35, 2026-10-08), opened from the Profile tab,
// Settings and Dating Preferences, so Back returns to where the person was.
const lcFirst = (n) => n.charAt(0).toLowerCase() + n.slice(1);
const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Discover: { active: 'compass', inactive: 'compass-outline' },
  Create: { active: 'add-circle', inactive: 'add-circle-outline' },
  Activity: { active: 'notifications', inactive: 'notifications-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
};

function BouncyTabButton({ children, onPress, accessibilityLabel, accessibilityState }) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePress(event) {
    // Tiny-tier press feedback, same feel as ScaleButton -- no overshoot on a plain tab tap.
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.92, speed: 50, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 20, bounciness: 6, useNativeDriver: true }),
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
  const { t } = useLanguage();
  const [activityBadgeCount, setActivityBadgeCount] = useState(0);

  useEffect(() => {
    loadActivityBadgeCount();
    const interval = setInterval(loadActivityBadgeCount, 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadActivityBadgeCount() {
    const count = await getActivityBadgeCount();
    setActivityBadgeCount(count);
  }

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarLabel: t(`ui.nav.tab.${lcFirst(route.name)}`),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarButton: (props) => (
          <BouncyTabButton
            {...props}
            accessibilityLabel={t(`ui.nav.tab.${lcFirst(route.name)}`)}
          />
        ),
        tabBarIcon: ({ focused, size }) => {
          const iconSet = TAB_ICONS[route.name];
          const iconName = focused ? iconSet.active : iconSet.inactive;
          return <Ionicons name={iconName} size={size} color={focused ? colors.primary : colors.textTertiary} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Discover" component={DiscoverHubScreen} />
      <Tab.Screen name="Create" component={CreateHubScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} options={{ tabBarBadge: activityBadgeCount > 0 ? activityBadgeCount : undefined }} listeners={{ focus: loadActivityBadgeCount }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { t } = useLanguage();
  const { session, loading, profileComplete, profileLoading } = useAuth();
  // Item 127: Reduce Motion swaps every stack push/modal slide for a plain crossfade.
  const reduceMotion = useReduceMotion();
  const { colors } = useTheme();

  // Item 139: a return trail never outlives the session that made it.
  useEffect(() => {
    if (!session) clearTrail();
  }, [session]);

  // Item 139: one handler for every nearby:// link (outsideEntry.js). Signed in and mounted: open it now, on top of where
  // the person is (a gathering/apply link the linking config already opened is refreshed in place, not duplicated).
  // Otherwise (signed out, onboarding, still starting): keep it, timestamped, and open it once signed in. A link is never
  // kept while the signed-in stack is mounted, so nothing replays on a later launch.
  useEffect(() => {
    function handleUrl(url, { initial }) {
      const link = parseNearbyUrl(url);
      if (!link) return;
      if (canOpenFromOutside(navigationRef)) {
        if (link.kind === 'business') resolveAndNavigateToBusiness(link.id);
        // A warm gathering/apply link is opened by the linking config itself; only the launch URL is opened here.
        else if (initial && link.kind === 'gathering') openOnTop(navigationRef, 'GatheringDetail', { gatheringId: link.id });
        else if (initial && link.kind === 'apply') openOnTop(navigationRef, 'BusinessPartnerApply');
        return;
      }
      if (link.kind === 'gathering') keepEntry(AsyncStorage, PENDING_GATHERING_LINK_KEY, link.id);
      if (link.kind === 'business') keepEntry(AsyncStorage, PENDING_BUSINESS_LINK_KEY, link.id);
      if (link.kind === 'apply') keepEntry(AsyncStorage, PENDING_BUSINESS_APPLY_LINK_KEY, 'true');
    }
    Linking.getInitialURL().then((url) => handleUrl(url, { initial: true }));
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url, { initial: false }));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (session && profileComplete) {
      // Kept links and push taps open once the signed-in stack is actually mounted (it may still be rendering).
      whenOpenable(navigationRef, async () => {
        const gatheringId = await takeEntry(AsyncStorage, PENDING_GATHERING_LINK_KEY);
        if (gatheringId) openOnTop(navigationRef, 'GatheringDetail', { gatheringId });
        const partnerId = await takeEntry(AsyncStorage, PENDING_BUSINESS_LINK_KEY);
        if (partnerId) await resolveAndNavigateToBusiness(partnerId);
        const apply = await takeEntry(AsyncStorage, PENDING_BUSINESS_APPLY_LINK_KEY);
        if (apply === 'true') openOnTop(navigationRef, 'BusinessPartnerApply');
        await consumePendingNotificationTap();
      });
      initPurchases(session.user.id);
      registerForPushNotifications(session.user.id);
      startBackgroundPresenceReporting();
      updateBadgeCount(session.user.id);
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


  // Item 57 ("the N mark as product language ... subtle brand transitions"):
  // the Stack.Navigator below swaps its entire set of screens (a different
  // ternary branch) on two real app-level state flips -- signing out
  // (session -> null) and finishing onboarding (profileComplete -> true) --
  // and until now that was an instant, un-transitioned cut with zero brand
  // touch on either edge. This doesn't change the real navigation logic at
  // all; it only inserts one brief NLoader beat (the same component the
  // boot gate below already uses) between the two real states, on
  // exactly those two flips -- never on first mount (both refs start
  // already equal to the initial values, so there's nothing to detect yet).
  const prevSessionRef = useRef(session);
  const prevProfileCompleteRef = useRef(profileComplete);
  const [brandTransitioning, setBrandTransitioning] = useState(false);
  useEffect(() => {
    const wasSignedIn = !!prevSessionRef.current;
    const isSignedIn = !!session;
    const justSignedOut = wasSignedIn && !isSignedIn;
    const justFinishedOnboarding = isSignedIn && !prevProfileCompleteRef.current && profileComplete;
    prevSessionRef.current = session;
    prevProfileCompleteRef.current = profileComplete;
    if (justSignedOut || justFinishedOnboarding) {
      setBrandTransitioning(true);
      const timer = setTimeout(() => setBrandTransitioning(false), 450);
      return () => clearTimeout(timer);
    }
  }, [session, profileComplete]);

  // Sep 6 2026 (CLAUDE.md, external UX critique item 13): this used to be
  // a bare blank screen while the session/profile check resolves -- the
  // one moment every single app open passes through, and the most natural
  // place for the new branded loading treatment (NLoader, src/motion/)
  // rather than a generic spinner.
  if (loading || (session && profileLoading) || brandTransitioning) return <NLoader />;

  return (
    <NavigationContainer ref={navigationRef} linking={linking} onStateChange={noteNavigationState}>
      <Stack.Navigator screenOptions={{ headerShown: false, ...(reduceMotion ? { animation: 'fade' } : null) }}>
        {!session ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="OnboardingQuestions" component={OnboardingQuestionsScreen} />
            <Stack.Screen name="OnboardingLocation" component={OnboardingLocationScreen} />
            <Stack.Screen name="OnboardingNotifications" component={OnboardingNotificationsScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </>
        ) : !profileComplete ? (
          <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            {/* Phase 5: Profile left the bottom tab bar -- reached via the
                persistent header-icon avatar (TabHeaderActions) -- and
                stays a real, pushed screen (a transparent native header for
                the real back chevron, same shape as Nearby/Gatherings/
                Communities below, since it already renders its own in-JS
                header/title). Discover, unlike Profile, is a real bottom
                tab again as of Aug 24 2026 (see CLAUDE.md) -- People merged
                into it as a mode, so there's no separate pushed Discover
                screen anymore; `navigate('Discover')` from a sibling tab
                resolves to the tab directly. */}
            <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: true, title: t('ui.profile.editYourProfile'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Messages" component={MessagesScreen} options={{ headerShown: true, title: t('ui.nav.title.messages'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="OnboardingRecommendations" component={OnboardingRecommendationsScreen} />
            <Stack.Screen name="OnboardingOccasions" component={OnboardingOccasionsScreen} />
            {/* headerShown starts true (blank title, real back chevron) so
                the loading/error states -- before ChatScreen's own init()
                calls setOptions() with the real title/icons -- aren't a
                dead end on a load failure. ChatScreen's own setOptions
                calls only ever layer title/headerRight on top, never turn
                the header off. */}
            <Stack.Screen name="Chat" component={ChatScreen} options={{ headerShown: true, title: '', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Billing" component={BillingScreen} options={{ headerShown: true, title: t('ui.nav.title.billing'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="DatingPreferences" component={DatingPreferencesScreen} options={{ headerShown: true, title: t('ui.nav.title.datingPreferences'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
            <Stack.Screen name="ViewProfile" component={ViewProfileScreen} options={{ headerShown: true, title: t('ui.nav.title.viewProfile'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true, title: t('ui.nav.title.settings'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Legal" component={LegalScreen} options={{ headerShown: true, title: t('ui.nav.title.legal'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="CreateGathering" component={CreateGatheringScreen} options={{ headerShown: true, title: t('ui.nav.title.createGathering'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            {/* User-facing name is "Plan for Someone" (Item 83, CLAUDE.md,
                direct user request -- "'Occasion' sounds like internal
                product terminology; 'Plan for Someone' immediately
                communicates the action," superseding Item 61's earlier
                "Occasion" rename). Internal route key/component/file stay
                CelebrateSomething* (Item 61's original name, and no genuine
                collision risk since internal identifiers aren't
                user-visible), matching this repo's own precedent of not
                renaming plumbing purely for a copy change. See
                CelebrateSomethingScreen.js's own header. */}
            <Stack.Screen name="CelebrateSomething" component={CelebrateSomethingScreen} options={{ headerShown: true, title: t('ui.nav.title.celebrateSomething'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="SharedPlaylist" component={SharedPlaylistScreen} options={{ headerShown: true, title: t('ui.nav.title.sharedPlaylist'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="TogetherNotes" component={TogetherNotesScreen} options={({ route }) => ({ headerShown: true, title: t(TOGETHER_NOTES_KINDS[route.params?.kind]?.navTitleKey ?? 'ui.nav.title.tripPlanning'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false })} />
            <Stack.Screen name="RelationshipLegacy" component={RelationshipLegacyScreen} options={{ headerShown: true, title: t('ui.nav.title.relationshipLegacy'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="LegacyLibrary" component={LegacyLibraryScreen} options={{ headerShown: true, title: t('ui.nav.title.legacyLibrary'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GoodbyeArchiveList" component={GoodbyeArchiveListScreen} options={{ headerShown: true, title: t('ui.nav.title.goodbyeArchiveList'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RelationshipEmergencyKit" component={RelationshipEmergencyKitScreen} options={{ headerShown: true, title: t('ui.nav.title.relationshipEmergencyKit'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MemoryVault" component={MemoryVaultScreen} options={{ headerShown: true, title: t('ui.nav.title.memoryVault'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            {/* Convergence pass P2 (CLAUDE.md): the old separate "Insights"
                route is retired -- MomentumScreen now covers both, one
                real "how am I doing" destination instead of two. */}
            <Stack.Screen name="Momentum" component={MomentumScreen} options={{ headerShown: true, title: t('ui.nav.title.momentum'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Plans" component={PlansScreen} options={{ headerShown: true, title: t('ui.nav.title.plans'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MarketValidation" component={MarketValidationScreen} options={{ headerShown: true, title: 'Market Validation', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessAIAssistant" component={BusinessAIAssistantScreen} options={{ headerShown: true, title: 'AI Assistant', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} options={{ headerShown: true, title: t('ui.nav.title.emergencyContacts'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Occasions" component={OccasionsScreen} options={{ headerShown: true, title: t('ui.nav.title.occasions'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MusicMode" component={MusicModeScreen} options={{ headerShown: true, title: t('ui.nav.title.musicMode'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="ChemistryDiaryList" component={ChemistryDiaryListScreen} options={{ headerShown: true, title: t('ui.nav.title.chemistryDiaryList'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RehearsalRoom" component={RehearsalRoomScreen} options={{ headerShown: true, title: t('ui.nav.title.rehearsalRoom'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="IdVerification" component={IdVerificationScreen} options={{ headerShown: true, title: t('ui.nav.title.idVerification'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminVerification" component={AdminVerificationScreen} options={{ headerShown: true, title: 'Verifications (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="InviteFriends" component={InviteFriendsScreen} options={{ headerShown: true, title: t('ui.nav.title.inviteFriends'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="SelectGatheringLocation" component={SelectGatheringLocationScreen} options={{ headerShown: true, title: t('ui.nav.title.selectGatheringLocation'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GatheringDetail" component={GatheringDetailScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Notices" component={ActivityScreen} options={{ headerShown: true, title: t('ui.nav.title.notices'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="Friends" component={FriendsScreen} options={{ headerShown: true, title: t('ui.nav.title.friends'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen
              name="GatheringChat"
              component={GatheringChatScreen}
              options={({ route, navigation }) => ({
                headerShown: true,
                // P1 remediation (CLAUDE.md, Aug 28 Full Coherence Audit,
                // "the chat-header issue is easy") -- matches 1:1
                // ChatScreen's own tappable-header-title pattern
                // (headerTitle -> ViewProfile). GatheringChat has 3 real
                // entry points (GatheringDetail and its
                // attending section, GatheringsScreen), never just the one CommunityChatScreen
                // has -- so, unlike that screen's own already-fixed "tap
                // just pops back to where you came from" bug, tapping here
                // genuinely pushes a real GatheringDetail most of the time,
                // not a disguised back button.
                headerTitle: () => (
                  <TouchableOpacity
                    onPress={() => route.params?.gatheringId && navigation.navigate('GatheringDetail', { gatheringId: route.params.gatheringId })}
                    accessibilityLabel={route.params?.gatheringTitle ? t('ui.nav.viewA11y', { title: route.params.gatheringTitle }) : t('ui.nav.viewGatheringA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '600' }}>
                      {route.params?.gatheringTitle ? t('ui.groupChat.chat', { title: route.params.gatheringTitle }) : t('ui.nav.groupChat')}
                    </Text>
                  </TouchableOpacity>
                ),
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.textPrimary,
                headerShadowVisible: false,
              })}
            />
            {/* Thursday plan item 19 ("filters should behave like controls
                sitting on top of results, not destinations"): presentation:
                'modal' makes this slide up as a layer over Discover/People
                rather than push as a new stack destination -- same screen,
                same content, no rewrite, just corrects the one concrete gap
                the audit found (FiltersModal itself was already a real
                in-place modal; only this deeper "Customize" screen wasn't). */}
            <Stack.Screen name="PreferencePolls" component={PreferencePollScreen} options={{ headerShown: true, title: t('ui.nav.title.preferencePolls'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} options={{ headerShown: true, title: t('ui.nav.title.createCommunity'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="EditCommunity" component={EditCommunityScreen} options={{ headerShown: true, title: t('ui.nav.title.editCommunity'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="CommunityDetail" component={CommunityDetailScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen
              name="CommunityChat"
              component={CommunityChatScreen}
              options={({ route }) => ({
                headerShown: true,
                title: route.params?.communityName ? t('ui.groupChat.chat', { title: route.params.communityName }) : t('ui.nav.communityChat'),
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.textPrimary,
                headerShadowVisible: false,
                // headerRight is no longer set here -- it used to navigate
                // straight to CommunityDetail, which (since this screen is
                // only ever reached FROM CommunityDetail) just popped back to
                // the exact screen already on the stack, indistinguishable
                // from the back button and confusing as a result. The screen
                // itself now owns headerRight via navigation.setOptions and
                // opens a real in-chat info panel instead.
              })}
            />
            <Stack.Screen name="BusinessDashboard" component={BusinessDashboardScreen} options={{ headerShown: true, title: 'Business Dashboard', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="BusinessPartnerApply" component={BusinessPartnerApplyScreen} options={{ headerShown: true, title: 'Get Your Business on Nearby', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="MyBusinessApplication" component={MyBusinessApplicationScreen} options={{ headerShown: true, title: 'My Application', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="RequestBusinessPartner" component={RequestBusinessPartnerScreen} options={{ headerShown: true, title: t('ui.nav.title.requestBusinessPartner'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AskBusiness" component={AskBusinessScreen} options={{ headerShown: true, title: t('ui.nav.title.askBusiness'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="BusinessRequestDetail" component={BusinessRequestDetailScreen} options={{ headerShown: true, title: t('ui.nav.title.businessRequestDetail'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen
              name="PlanChat"
              component={PlanChatScreen}
              options={{
                headerShown: true,
                title: t('ui.nav.title.planChat'),
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.textPrimary,
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen name="GroupPlan" component={GroupPlanScreen} options={{ headerShown: true, title: t('ui.nav.title.groupPlan'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="PlanDetail" component={PlanDetailScreen} options={{ headerShown: true, title: t('ui.nav.title.planDetail'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="SharedNight" component={SharedNightScreen} options={{ headerShown: true, title: t('ui.nav.title.sharedNight'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="GroupOccasionPlan" component={GroupOccasionPlanScreen} options={{ headerShown: true, title: t('ui.nav.title.groupOccasionPlan'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="DateProposal" component={DateProposalScreen} options={{ headerShown: true, title: t('ui.nav.title.dateProposal'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminBusinessRequests" component={AdminBusinessRequestsScreen} options={{ headerShown: true, title: 'Business Requests (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminSponsoredRefunds" component={AdminSponsoredRefundsScreen} options={{ headerShown: true, title: 'Sponsored Refunds (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminBusinessTier" component={AdminBusinessTierScreen} options={{ headerShown: true, title: 'Business Tier Switch (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="AdminContentReview" component={AdminContentReviewScreen} options={{ headerShown: true, title: 'Content Review Queue (Admin)', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen
              name="BusinessConversation"
              component={BusinessConversationScreen}
              options={({ route, navigation }) => ({
                headerShown: true,
                // P1 remediation (CLAUDE.md, Aug 28 Full Coherence Audit) --
                // same tappable-header pattern as GatheringChat above,
                // matching 1:1 ChatScreen's own established convention:
                // "report menu but no view business" is now a real
                // tap-through to BusinessProfileScreen.
                headerTitle: () => (
                  <TouchableOpacity
                    onPress={() => route.params?.partnerId && navigation.navigate('BusinessProfile', { partnerId: route.params.partnerId })}
                    accessibilityLabel={route.params?.partnerName ? t('ui.nav.viewProfileA11y', { name: route.params.partnerName }) : t('ui.nav.viewBusinessProfileA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '600' }}>
                      {route.params?.partnerName ?? t('ui.nav.message')}
                    </Text>
                  </TouchableOpacity>
                ),
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.textPrimary,
                headerShadowVisible: false,
              })}
            />
            <Stack.Screen name="BusinessProfile" component={BusinessProfileScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
            <Stack.Screen name="EditGathering" component={EditGatheringScreen} options={{ headerShown: true, title: t('ui.nav.title.editGathering'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false, presentation: 'modal' }} />
            <Stack.Screen name="FriendDiscovery" component={FriendDiscoveryScreen} options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}